import type { Rect, TextRegion } from "@umt/shared";
import type { OcrCacheStore } from "../cache/ocr-cache.js";
import type { ApiKeyPoolStatus } from "@umt/core";
import type { ProviderInput, VisionProvider } from "./provider.js";

export interface OcrRegion {
  id: string;
  box: Rect;
  sourceText: string;
  confidence: number;
  orientation: TextRegion["orientation"];
  kind: TextRegion["kind"];
}

export interface OcrProvider {
  recognize(input: ProviderInput): Promise<OcrRegion[]>;
}

export interface TextTranslationItem {
  id: string;
  text: string;
}

export interface TextTranslationResult {
  id: string;
  translatedText: string;
}

export interface TextTranslationOptions {
  retranslate?: boolean;
  /** External cancellation signal (user cancel); aborts in-flight requests. */
  signal?: AbortSignal;
}

export interface TextTranslationProvider {
  listModels?(): Promise<string[]>;
  translate(items: TextTranslationItem[], targetLanguage: string, sourceLanguage: string, options?: TextTranslationOptions): Promise<TextTranslationResult[]>;
}

export interface OcrThenTranslateProviderOptions {
  profile: string;
  ocr: OcrProvider;
  translator: TextTranslationProvider;
  ocrCache?: OcrCacheStore;
}

export class OcrThenTranslateProvider implements VisionProvider {
  readonly profile: string;
  lastOcrCacheStatus: "hit" | "miss" | "disabled" = "disabled";

  constructor(private readonly options: OcrThenTranslateProviderOptions) {
    this.profile = options.profile;
  }

  keyStatus(): ApiKeyPoolStatus | undefined {
    const maybeKeyed = this.options.ocr as { keyStatus?: () => ApiKeyPoolStatus };
    return maybeKeyed.keyStatus?.();
  }

  async listModels(): Promise<string[]> {
    return this.options.translator.listModels ? this.options.translator.listModels() : [this.profile];
  }

  async process(input: ProviderInput): Promise<TextRegion[]> {
    const ocrRegions = await this.readOcrRegions(input);
    const latinDominant = isLatinDominantPage(ocrRegions);
    const classified = ocrRegions.map((region) => classifyRegionKind(region, input.width, input.height, latinDominant));
    const textBlocks = groupOcrRegionsIntoTextBlocks(classified);
    const translationOptions: TextTranslationOptions = { retranslate: input.forceRetranslate === true };
    if (input.signal) translationOptions.signal = input.signal;
    const translated = await this.options.translator.translate(
      textBlocks.map((region) => ({ id: region.id, text: region.sourceText })),
      input.task.targetLanguage,
      input.task.sourceLanguage,
      translationOptions,
    );
    const translatedById = new Map(translated.map((item) => [item.id, item.translatedText]));
    return textBlocks.map((region) => ({
      id: region.id,
      box: region.box,
      sourceText: region.sourceText,
      translatedText: translatedById.get(region.id) ?? region.sourceText,
      confidence: region.confidence,
      orientation: region.orientation,
      kind: region.kind,
    }));
  }

  private async readOcrRegions(input: ProviderInput): Promise<OcrRegion[]> {
    if (!this.options.ocrCache) {
      this.lastOcrCacheStatus = "disabled";
      return this.options.ocr.recognize(input);
    }
    const key = buildOcrCacheKey(this.profile, input);
    const cached = this.options.ocrCache.get(key);
    if (cached) {
      this.lastOcrCacheStatus = "hit";
      return cached;
    }
    this.lastOcrCacheStatus = "miss";
    const regions = await this.options.ocr.recognize(input);
    if (regions.length > 0) this.options.ocrCache.save(key, regions);
    return regions;
  }
}

export function buildOcrCacheKey(profile: string, input: ProviderInput): string {
  return JSON.stringify({
    v: 1,
    ocrProfile: profile.split("+openai-compatible:")[0],
    imageHash: input.imageHash,
    width: input.width,
    height: input.height,
    sourceLanguage: input.task.sourceLanguage,
  });
}

export function groupOcrRegionsIntoTextBlocks(regions: OcrRegion[]): OcrRegion[] {
  const candidates = dedupeOcrRegions(regions)
    .filter((region) => region.sourceText.trim().length > 0 && region.box.width > 1 && region.box.height > 1)
    .sort(compareOcrReadingOrder);
  const groups: OcrRegion[][] = [];
  for (const region of candidates) {
    const lastGroup = groups.at(-1);
    if (lastGroup && shouldJoinGroup(lastGroup, region)) lastGroup.push(region);
    else groups.push([region]);
  }
  return groups.map((group) => group.length === 1 ? group[0]! : mergeGroup(group));
}

function shouldJoinGroup(group: OcrRegion[], next: OcrRegion): boolean {
  const previous = group.at(-1)!;
  if (previous.orientation !== next.orientation) return false;
  if (previous.kind !== next.kind) return false;
  if (previous.kind === "sfx" || next.kind === "sfx") return false;
  if (next.orientation === "vertical") return false;
  const union = unionRect(group.map((region) => region.box));
  const averageHeight = (previous.box.height + next.box.height) / 2;
  if (verticalOverlap(union, next.box) >= Math.min(union.height, next.box.height) * 0.6) {
    const horizontalGap = Math.max(0, next.box.x - (union.x + union.width));
    if (next.kind === "narration") {
      // Caption boxes: horizontally split fragments of one line are common.
      const maxSameLineGap = Math.max(60, averageHeight * 2.6);
      if (horizontalGap <= maxSameLineGap) return true;
    } else if (next.kind === "dialogue") {
      // Speech bubbles: adjacent bubbles must never fuse into one giant
      // overlay; only merge tiny gaps that look like OCR splits of one line.
      const maxSameLineGap = Math.max(16, averageHeight * 0.55);
      if (horizontalGap <= maxSameLineGap) return true;
    }
  }
  const previousBottom = previous.box.y + previous.box.height;
  const verticalGap = next.box.y - previousBottom;
  const groupCenterX = union.x + union.width / 2;
  const nextCenterX = next.box.x + next.box.width / 2;
  const centerDistance = Math.abs(groupCenterX - nextCenterX);
  const overlap = horizontalOverlap(union, next.box);
  const merged = unionRect([...group.map((region) => region.box), next.box]);
  const mergedHeight = merged.height;
  const mergedWidth = merged.width;
  // Only merge vertically when the two boxes genuinely look like one large
  // bubble: tight thresholds plus a horizontal-overlap requirement so
  // vertically adjacent DISTINCT bubbles are NOT fused into one giant overlay.
  const looksLikeSameLargeBubble =
    next.kind === "dialogue"
    && verticalGap >= -averageHeight * 0.35
    && verticalGap <= Math.max(48, averageHeight * 1.15)
    && centerDistance <= Math.max(mergedWidth * 0.36, averageHeight * 2.2)
    && overlap >= Math.min(union.width, next.box.width) * 0.12
    && mergedHeight <= Math.max(260, averageHeight * 4.6)
    && mergedWidth <= Math.max(640, averageHeight * 8);
  if (looksLikeSameLargeBubble) return true;
  if (verticalGap < -averageHeight * 0.25 || verticalGap > Math.max(22, averageHeight * 0.7)) return false;
  const maxReasonableDistance = Math.max(union.width, next.box.width) * 0.38;
  return centerDistance <= maxReasonableDistance || overlap >= Math.min(union.width, next.box.width) * 0.3;
}

function classifyRegionKind(region: OcrRegion, imageWidth: number, imageHeight: number, latinDominant: boolean): OcrRegion {
  if (region.kind !== "dialogue") return region;
  if (looksLikeNonLatinSoundEffect(region.sourceText, latinDominant)) return { ...region, kind: "sfx" };
  return looksLikeActionLettering(region, imageWidth, imageHeight) ? { ...region, kind: "sfx" } : region;
}

/**
 * On pages dominated by Latin text (e.g. English-localized manhwa), Korean
 * hangul, punctuation-only, and short unknown non-Latin strings are almost
 * always borderless sound effects and must not be covered by an opaque
 * bubble. On non-Latin-dominant pages (raw JP/KR/CN manga), non-Latin text is
 * body copy and stays dialogue.
 */
function looksLikeNonLatinSoundEffect(text: string, latinDominant: boolean): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const letters = Array.from(trimmed).filter((char) => /\p{L}/u.test(char));
  if (!letters.length) return true; // punctuation / symbols only
  const latin = letters.filter((char) => /[A-Za-z]/u.test(char)).length;
  if (latin > 0) return false; // contains latin → regular text
  if (!latinDominant) return false; // raw-language page → body text
  const short = Array.from(trimmed.replace(/\s+/g, "")).length <= 10;
  const hangul = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(trimmed);
  return short || hangul;
}

/** True when the majority of letters on the page are Latin. */
function isLatinDominantPage(regions: OcrRegion[]): boolean {
  let latin = 0;
  let total = 0;
  for (const region of regions) {
    for (const char of region.sourceText) {
      if (/\p{L}/u.test(char)) {
        total += 1;
        if (/[A-Za-z]/u.test(char)) latin += 1;
      }
    }
  }
  return total === 0 || latin / total >= 0.5;
}

function looksLikeActionLettering(region: OcrRegion, imageWidth: number, imageHeight: number): boolean {
  const text = region.sourceText.trim();
  const letters = Array.from(text).filter((char) => /\p{L}/u.test(char));
  if (!letters.length) return false;
  const uppercaseLetters = letters.filter((char) => char.toLocaleUpperCase() === char && char.toLocaleLowerCase() !== char).length;
  const uppercaseRatio = uppercaseLetters / letters.length;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const averageLineLength = lines.reduce((sum, line) => sum + Array.from(line.replace(/\s+/g, "")).length, 0) / Math.max(1, lines.length);
  const largeActionBox =
    region.box.height >= Math.max(220, imageHeight * 0.03)
    && region.box.width >= Math.max(220, imageWidth * 0.25);
  return largeActionBox && uppercaseRatio >= 0.78 && lines.length <= 4 && averageLineLength <= 9;
}

function mergeGroup(group: OcrRegion[]): OcrRegion {
  const union = unionRect(group.map((region) => region.box));
  const padX = Math.max(8, Math.round(union.width * 0.03));
  const padY = Math.max(8, Math.round(union.height * 0.05));
  return {
    id: `block-${group[0]!.id}`,
    box: { x: union.x - padX, y: union.y - padY, width: union.width + padX * 2, height: union.height + padY * 2 },
    sourceText: group.map((region) => region.sourceText.trim()).join("\n"),
    confidence: group.reduce((sum, region) => sum + region.confidence, 0) / group.length,
    orientation: group[0]!.orientation,
    kind: group[0]!.kind,
  };
}

function unionRect(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function horizontalOverlap(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
}

function verticalOverlap(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

function dedupeOcrRegions(regions: OcrRegion[]): OcrRegion[] {
  const sorted = [...regions].sort((a, b) => b.confidence - a.confidence);
  const kept: OcrRegion[] = [];
  for (const region of sorted) {
    const duplicate = kept.some((existing) => normalizeText(existing.sourceText) === normalizeText(region.sourceText) && rectIoU(existing.box, region.box) > 0.65);
    if (!duplicate) kept.push(region);
  }
  return kept.sort(compareOcrReadingOrder);
}

function compareOcrReadingOrder(a: OcrRegion, b: OcrRegion): number {
  const sameHorizontalBand = Math.abs(a.box.y - b.box.y) <= Math.max(a.box.height, b.box.height) * 0.35;
  if (sameHorizontalBand) return a.box.x - b.box.x;
  return a.box.y - b.box.y || a.box.x - b.box.x;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function rectIoU(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

