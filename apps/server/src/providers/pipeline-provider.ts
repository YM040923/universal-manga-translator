import { reconstructBubbles } from "@umt/core";
import type { Rect, TextRegion } from "@umt/shared";
import type { OcrCacheStore } from "../cache/ocr-cache.js";
import type { ApiKeyPoolStatus } from "./api-key-pool.js";
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
    const ocrRegions = (await this.readOcrRegions(input)).map((region) => classifyRegionKind(region, input.width, input.height));
    const textBlocks = groupOcrRegionsIntoTextBlocks(ocrRegions);
    const translated = await this.options.translator.translate(
      textBlocks.map((region) => ({ id: region.id, text: region.sourceText })),
      input.task.targetLanguage,
      input.task.sourceLanguage,
      { retranslate: input.forceRetranslate === true },
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
  const reconstructable = regions.filter(isReconstructableRegion);
  const reconstructed = reconstructBubbles(reconstructable).map((bubble): OcrRegion => ({
    id: bubble.id,
    box: bubble.box,
    sourceText: bubble.sourceText,
    confidence: bubble.confidence,
    orientation: bubble.orientation,
    kind: bubble.kind,
  }));
  const unsupported = regions.filter((region) => !isReconstructableRegion(region));
  return [...reconstructed, ...unsupported]
    .filter((region) => region.sourceText.trim().length > 0 && region.box.width > 1 && region.box.height > 1)
    .sort(compareOcrReadingOrder);
}

function isReconstructableRegion(
  region: OcrRegion,
): region is OcrRegion & {
  orientation: "horizontal" | "vertical";
  kind: "dialogue" | "narration" | "sfx";
} {
  return (region.orientation === "horizontal" || region.orientation === "vertical")
    && (region.kind === "dialogue" || region.kind === "narration" || region.kind === "sfx");
}

function classifyRegionKind(region: OcrRegion, imageWidth: number, imageHeight: number): OcrRegion {
  if (region.kind !== "dialogue") return region;
  return looksLikeActionLettering(region, imageWidth, imageHeight) ? { ...region, kind: "sfx" } : region;
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

function compareOcrReadingOrder(a: OcrRegion, b: OcrRegion): number {
  const sameHorizontalBand = Math.abs(a.box.y - b.box.y) <= Math.max(a.box.height, b.box.height) * 0.35;
  if (sameHorizontalBand) return a.box.x - b.box.x;
  return a.box.y - b.box.y || a.box.x - b.box.x;
}

