import type { RecognitionUnit, Rect, TextRegion } from "@umt/shared";
import type { ApiKeyPoolStatus } from "./api-key-pool.js";
import { reconstructBubbles, type BubbleOwnershipEvidence } from "./bubble-reconstruction.js";
import { classifyGenericOcrError, type GenericOcrImageInput, type GenericOcrRegion } from "./generic-ocr.js";
import {
  getOcrPreprocessVariant,
  selectOcrRescueVariant,
  type OcrPreprocessVariant,
  type OcrPreprocessVariantId,
} from "./ocr-preprocess.js";
import { assessOcrQuality, shouldAcceptRescue, type OcrQualityReason } from "./ocr-quality.js";
import type { TextTranslationItem, TextTranslationOptions, TextTranslationProvider, TextTranslationResult } from "./openai-translator.js";

export type { GenericOcrRegion, TextTranslationItem, TextTranslationOptions, TextTranslationResult };

export interface CorePipelineInput extends GenericOcrImageInput {
  imageHash: string;
  width: number;
  height: number;
  targetLanguage: string;
  sourceLanguage: string;
  retranslate?: boolean;
  glossary?: Record<string, string>;
  chapterContext?: string;
  previousTranslations?: Array<{ id: string; translatedText: string }>;
  termCandidates?: string[];
  preCroppedOcrInputs?: CorePreCroppedOcrInput[];
  preCroppedOcrInputLoader?: CorePreCroppedOcrInputLoader;
  onOcrTileError?: (failure: CoreOcrTileFailure) => void;
  recognitionUnit?: RecognitionUnit;
  likelyTextEvidence?: boolean;
  bubbleEvidenceExtractor?: CoreBubbleEvidenceExtractor;
  maxOcrRescueCallsPerImage?: number;
  ocrPreprocessLoader?: CoreOcrPreprocessLoader;
  onOcrRescueDiagnostic?: (diagnostic: CoreOcrRescueDiagnostic) => void;
}

export interface CorePreCroppedOcrInput extends GenericOcrImageInput {
  recognitionUnit: RecognitionUnit;
  ocrVariant?: OcrPreprocessVariantId;
}

export interface CorePreCroppedOcrInputLoader {
  tileCount: number;
  forEach(consume: (input: CorePreCroppedOcrInput, index: number) => Promise<void>): Promise<void>;
}

export interface CoreBubbleEvidenceExtractionInput extends GenericOcrImageInput {
  width: number;
  height: number;
  observations: readonly GenericOcrRegion[];
  recognitionUnit: RecognitionUnit;
}

export type CoreBubbleEvidenceExtractor = (
  input: CoreBubbleEvidenceExtractionInput,
) => Promise<BubbleOwnershipEvidence[]>;

export interface CoreOcrTileFailure {
  tileIndex: number;
  tileCount: number;
  recognitionUnit: RecognitionUnit;
  error: Error;
}

export interface CoreOcrPreprocessSourceInput extends GenericOcrImageInput {
  recognitionUnit: RecognitionUnit;
}

export interface CoreOcrPreprocessLoader {
  withVariant<T>(
    source: CoreOcrPreprocessSourceInput,
    variant: OcrPreprocessVariant,
    consume: (input: CorePreCroppedOcrInput) => Promise<T>,
  ): Promise<T>;
}

export interface CoreOcrRescueDiagnostic {
  reasons: OcrQualityReason[];
  variant: OcrPreprocessVariantId;
  usedBudget: number;
  remainingBudget: number;
  originalScore: number;
  rescueScore?: number;
  selected: "original" | "rescue";
  regionCount: number;
  characterCount: number;
  crop: Rect;
  errorKind?: ReturnType<typeof classifyGenericOcrError>["kind"];
}

export interface CoreOcrProvider {
  recognize(input: CorePipelineInput | CorePreCroppedOcrInput): Promise<GenericOcrRegion[]>;
  keyStatus?(): ApiKeyPoolStatus;
}

export interface CoreTextTranslator extends TextTranslationProvider {}

export interface CoreOcrCache {
  get(key: string): Promise<GenericOcrRegion[] | null> | GenericOcrRegion[] | null;
  set(key: string, regions: GenericOcrRegion[]): Promise<void> | void;
}

export interface OcrTranslatePipelineOptions {
  profile: string;
  ocr: CoreOcrProvider;
  translator: CoreTextTranslator;
  ocrCache?: CoreOcrCache;
}

export interface CorePipelineResult {
  regions: TextRegion[];
}

interface CoreOcrReadResult {
  regions: GenericOcrRegion[];
  bubbleEvidence: BubbleOwnershipEvidence[];
}

export class OcrTranslatePipeline {
  readonly profile: string;
  lastOcrCacheStatus: "hit" | "miss" | "coalesced" | "disabled" = "disabled";

  constructor(private readonly options: OcrTranslatePipelineOptions) {
    this.profile = options.profile;
  }

  keyStatus(): ApiKeyPoolStatus | undefined {
    return this.options.ocr.keyStatus?.();
  }

  async listModels(): Promise<string[]> {
    return this.options.translator.listModels ? this.options.translator.listModels() : [this.profile];
  }

  async process(input: CorePipelineInput): Promise<CorePipelineResult> {
    const ocrRead = await this.readOcrRegions(input);
    const ocrRegions = ocrRead.regions.map((region) => classifyRegionKind(region, input.width, input.height));
    const textBlocks = reconstructBubbles(ocrRegions, ocrRead.bubbleEvidence).map(bubbleToOcrRegion);
    const translationOptions: TextTranslationOptions = { retranslate: input.retranslate === true };
    if (input.glossary && Object.keys(input.glossary).length) translationOptions.glossary = input.glossary;
    if (input.chapterContext?.trim()) translationOptions.chapterContext = input.chapterContext.trim();
    if (input.previousTranslations?.length) translationOptions.previousTranslations = input.previousTranslations;
    const termCandidates = mergeUniqueTerms([...(input.termCandidates ?? []), ...extractTermCandidates(textBlocks)]);
    if (termCandidates.length) translationOptions.termCandidates = termCandidates;
    const translated = await this.options.translator.translate(
      buildTranslationItems(textBlocks),
      input.targetLanguage,
      input.sourceLanguage,
      translationOptions,
    );
    const translatedById = new Map(translated.map((item) => [item.id, item.translatedText]));
    return {
      regions: textBlocks.map((region) => ({
        id: region.id,
        box: region.box,
        sourceText: region.sourceText,
        translatedText: translatedById.get(region.id) ?? region.sourceText,
        confidence: region.confidence,
        orientation: region.orientation,
        kind: region.kind,
      })),
    };
  }

  private async readOcrRegions(input: CorePipelineInput): Promise<CoreOcrReadResult> {
    const rescueBudget = createOcrRescueBudget(input.maxOcrRescueCallsPerImage);
    if (input.preCroppedOcrInputLoader) {
      return this.readTiledOcrRegions(
        input,
        input.preCroppedOcrInputLoader.tileCount,
        input.preCroppedOcrInputLoader.forEach,
        rescueBudget,
      );
    }
    if (input.preCroppedOcrInputs?.length) {
      return this.readTiledOcrRegions(input, input.preCroppedOcrInputs.length, async (consume) => {
        for (const [index, ocrInput] of input.preCroppedOcrInputs!.entries()) await consume(ocrInput, index);
      }, rescueBudget);
    }
    const recognitionUnit = input.recognitionUnit ?? createFullImageRecognitionUnit(input);
    const original = await this.readSingleOcrInput(input, input);
    const sourceInput = {
      imageBytes: input.imageBytes,
      ...(input.fileName ? { fileName: input.fileName } : {}),
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      recognitionUnit,
    };
    const selected = await this.maybeRescueOcrRegions(input, sourceInput, original, [], rescueBudget, false);
    const bubbleEvidence = await this.readBubbleEvidence(input, sourceInput, selected);
    return { regions: selected, bubbleEvidence };
  }

  private async readTiledOcrRegions(
    input: CorePipelineInput,
    tileCount: number,
    forEach: CorePreCroppedOcrInputLoader["forEach"],
    rescueBudget: CoreOcrRescueBudget,
  ): Promise<CoreOcrReadResult> {
    const regions: GenericOcrRegion[] = [];
    const bubbleEvidence: BubbleOwnershipEvidence[] = [];
    await forEach(async (ocrInput, index) => {
      try {
        const original = await this.readSingleOcrInput(input, ocrInput, ocrInput.recognitionUnit, ocrInput.ocrVariant);
        const selected = await this.maybeRescueOcrRegions(
          input,
          ocrInput,
          original,
          regions,
          rescueBudget,
          true,
        );
        const tileEvidence = await this.readBubbleEvidence(input, ocrInput, selected);
        regions.push(...selected.map((region) => remapRegionToParent(region, ocrInput.recognitionUnit, input.width, input.height)));
        bubbleEvidence.push(...tileEvidence.map((evidence) => remapBubbleEvidenceToParent(
          evidence,
          ocrInput.recognitionUnit,
          input.width,
          input.height,
        )));
      } catch (cause) {
        const error = createOcrTileError(cause, index + 1, tileCount, ocrInput.recognitionUnit);
        input.onOcrTileError?.({ tileIndex: index + 1, tileCount, recognitionUnit: ocrInput.recognitionUnit, error });
        throw error;
      }
    });
    return { regions, bubbleEvidence };
  }

  private async readBubbleEvidence(
    parentInput: CorePipelineInput,
    sourceInput: CoreOcrPreprocessSourceInput,
    observations: GenericOcrRegion[],
  ): Promise<BubbleOwnershipEvidence[]> {
    const manualGroupId = sourceInput.recognitionUnit.reason === "manual-selection"
      ? sourceInput.recognitionUnit.id
      : undefined;
    let extracted: BubbleOwnershipEvidence[] = [];
    if (parentInput.bubbleEvidenceExtractor) {
      try {
        extracted = await parentInput.bubbleEvidenceExtractor({
          imageBytes: sourceInput.imageBytes,
          ...(sourceInput.fileName ? { fileName: sourceInput.fileName } : {}),
          ...(sourceInput.mimeType ? { mimeType: sourceInput.mimeType } : {}),
          width: sourceInput.recognitionUnit.pixelSize.width,
          height: sourceInput.recognitionUnit.pixelSize.height,
          observations,
          recognitionUnit: sourceInput.recognitionUnit,
        });
      } catch {
        extracted = [];
      }
    }
    if (!manualGroupId) return extracted;
    const extractedByObservationId = new Map(extracted.map((item) => [item.observationId, item]));
    return observations.map((observation) => ({
      ...extractedByObservationId.get(observation.id),
      observationId: observation.id,
      manualGroupId,
      confidence: extractedByObservationId.get(observation.id)?.confidence ?? 1,
      touchesBoundary: extractedByObservationId.get(observation.id)?.touchesBoundary ?? false,
    }));
  }

  private async readSingleOcrInput(
    parentInput: CorePipelineInput,
    ocrInput: CorePipelineInput | CorePreCroppedOcrInput,
    recognitionUnit?: RecognitionUnit,
    ocrVariant?: OcrPreprocessVariantId,
  ): Promise<GenericOcrRegion[]> {
    if (!this.options.ocrCache) {
      this.lastOcrCacheStatus = "disabled";
      return this.options.ocr.recognize(ocrInput);
    }
    const key = buildOcrCacheKey(this.profile, {
      imageHash: parentInput.imageHash,
      width: parentInput.width,
      height: parentInput.height,
      sourceLanguage: parentInput.sourceLanguage,
      ...(recognitionUnit ? { recognitionUnit } : {}),
      ...(ocrVariant && ocrVariant !== "original" ? { ocrVariant } : {}),
    });
    const cached = await this.options.ocrCache.get(key);
    if (cached) {
      this.lastOcrCacheStatus = "hit";
      return cached;
    }
    const inFlight = inFlightOcrReads.get(key);
    if (inFlight) {
      this.lastOcrCacheStatus = "coalesced";
      return inFlight;
    }
    this.lastOcrCacheStatus = "miss";
    const read = (async () => {
      const regions = await this.options.ocr.recognize(ocrInput);
      if (regions.length > 0) await this.options.ocrCache!.set(key, regions);
      return regions;
    })();
    inFlightOcrReads.set(key, read);
    try {
      return await read;
    } finally {
      if (inFlightOcrReads.get(key) === read) inFlightOcrReads.delete(key);
    }
  }

  private async maybeRescueOcrRegions(
    parentInput: CorePipelineInput,
    sourceInput: CoreOcrPreprocessSourceInput,
    originalRegions: GenericOcrRegion[],
    overlappingParentRegions: GenericOcrRegion[],
    budget: CoreOcrRescueBudget,
    remapForComparison: boolean,
  ): Promise<GenericOcrRegion[]> {
    const comparableOriginal = remapForComparison
      ? originalRegions.map((region) => remapRegionToParent(region, sourceInput.recognitionUnit, parentInput.width, parentInput.height))
      : originalRegions;
    const originalAssessment = assessOcrQuality(comparableOriginal, sourceInput.recognitionUnit, {
      ...(parentInput.likelyTextEvidence !== undefined ? { likelyTextEvidence: parentInput.likelyTextEvidence } : {}),
      overlappingObservations: overlappingParentRegions,
    });
    const variantId = selectOcrRescueVariant(originalAssessment);
    if (
      !variantId
      || !parentInput.ocrPreprocessLoader
      || budget.used >= budget.maximum
    ) {
      return originalRegions;
    }

    const variant = getOcrPreprocessVariant(variantId);
    budget.used += 1;
    try {
      let variantUnit = sourceInput.recognitionUnit;
      const rawRescueRegions = await parentInput.ocrPreprocessLoader.withVariant(sourceInput, variant, async (variantInput) => {
        variantUnit = variantInput.recognitionUnit;
        return this.readSingleOcrInput(
          parentInput,
          variantInput,
          variantInput.recognitionUnit,
          variantInput.ocrVariant ?? variant.id,
        );
      });
      const rescueRegions = rawRescueRegions.map((region) => remapRegionBetweenUnits(
        region,
        variantUnit,
        sourceInput.recognitionUnit,
      ));
      const comparableRescue = remapForComparison
        ? rescueRegions.map((region) => remapRegionToParent(region, sourceInput.recognitionUnit, parentInput.width, parentInput.height))
        : rescueRegions;
      const rescueAssessment = assessOcrQuality(comparableRescue, sourceInput.recognitionUnit, {
        ...(parentInput.likelyTextEvidence !== undefined ? { likelyTextEvidence: parentInput.likelyTextEvidence } : {}),
        overlappingObservations: overlappingParentRegions,
      });
      const useRescue = shouldAcceptRescue(
        { observations: comparableOriginal, assessment: originalAssessment },
        { observations: comparableRescue, assessment: rescueAssessment },
      );
      parentInput.onOcrRescueDiagnostic?.({
        reasons: [...originalAssessment.reasons],
        variant: variant.id,
        usedBudget: budget.used,
        remainingBudget: budget.maximum - budget.used,
        originalScore: originalAssessment.score,
        rescueScore: rescueAssessment.score,
        selected: useRescue ? "rescue" : "original",
        regionCount: originalAssessment.metrics.regionCount,
        characterCount: originalAssessment.metrics.characterCount,
        crop: { ...sourceInput.recognitionUnit.crop },
      });
      return useRescue ? rescueRegions : originalRegions;
    } catch (error) {
      parentInput.onOcrRescueDiagnostic?.({
        reasons: [...originalAssessment.reasons],
        variant: variant.id,
        usedBudget: budget.used,
        remainingBudget: budget.maximum - budget.used,
        originalScore: originalAssessment.score,
        selected: "original",
        regionCount: originalAssessment.metrics.regionCount,
        characterCount: originalAssessment.metrics.characterCount,
        crop: { ...sourceInput.recognitionUnit.crop },
        errorKind: classifyGenericOcrError(error).kind,
      });
      throw createOcrRescueError(error, variant.id, sourceInput.recognitionUnit);
    }
  }
}

const inFlightOcrReads = new Map<string, Promise<GenericOcrRegion[]>>();

interface CoreOcrRescueBudget {
  maximum: number;
  used: number;
}

function createOcrRescueBudget(value: number | undefined): CoreOcrRescueBudget {
  const maximum = Number.isFinite(value) ? Math.max(0, Math.min(3, Math.trunc(value!))) : 1;
  return { maximum, used: 0 };
}

function createFullImageRecognitionUnit(input: CorePipelineInput): RecognitionUnit {
  return {
    id: "full-image",
    parentSurfaceId: "full-image",
    imageHash: input.imageHash,
    crop: { x: 0, y: 0, width: input.width, height: input.height },
    naturalSize: { width: input.width, height: input.height },
    pixelSize: { width: input.width, height: input.height },
    scaleX: 1,
    scaleY: 1,
    priority: "p0",
    reason: "automatic",
    preprocessingVersion: "none-v1",
  };
}

function remapRegionToParent(
  region: GenericOcrRegion,
  unit: RecognitionUnit,
  parentWidth: number,
  parentHeight: number,
): GenericOcrRegion {
  const left = clamp(unit.crop.x + region.box.x / unit.scaleX, 0, parentWidth);
  const top = clamp(unit.crop.y + region.box.y / unit.scaleY, 0, parentHeight);
  const right = clamp(unit.crop.x + (region.box.x + region.box.width) / unit.scaleX, 0, parentWidth);
  const bottom = clamp(unit.crop.y + (region.box.y + region.box.height) / unit.scaleY, 0, parentHeight);
  return {
    ...region,
    id: `${unit.id}:${region.id}`,
    box: {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    },
  };
}

function remapBubbleEvidenceToParent(
  evidence: BubbleOwnershipEvidence,
  unit: RecognitionUnit,
  parentWidth: number,
  parentHeight: number,
): BubbleOwnershipEvidence {
  const remapped: BubbleOwnershipEvidence = {
    observationId: `${unit.id}:${evidence.observationId}`,
    confidence: evidence.confidence,
    touchesBoundary: evidence.touchesBoundary,
  };
  if (evidence.manualGroupId) remapped.manualGroupId = `${unit.id}:${evidence.manualGroupId}`;
  if (evidence.visualGroupId) remapped.visualGroupId = `${unit.id}:${evidence.visualGroupId}`;
  if (evidence.shape) remapped.shape = evidence.shape;
  if (evidence.componentBox) {
    remapped.componentBox = remapRectToParent(evidence.componentBox, unit, parentWidth, parentHeight);
  }
  return remapped;
}

function remapRectToParent(
  box: Rect,
  unit: RecognitionUnit,
  parentWidth: number,
  parentHeight: number,
): Rect {
  const left = clamp(unit.crop.x + box.x / unit.scaleX, 0, parentWidth);
  const top = clamp(unit.crop.y + box.y / unit.scaleY, 0, parentHeight);
  const right = clamp(unit.crop.x + (box.x + box.width) / unit.scaleX, 0, parentWidth);
  const bottom = clamp(unit.crop.y + (box.y + box.height) / unit.scaleY, 0, parentHeight);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function remapRegionBetweenUnits(
  region: GenericOcrRegion,
  fromUnit: RecognitionUnit,
  toUnit: RecognitionUnit,
): GenericOcrRegion {
  const naturalLeft = fromUnit.crop.x + region.box.x / fromUnit.scaleX;
  const naturalTop = fromUnit.crop.y + region.box.y / fromUnit.scaleY;
  const naturalRight = fromUnit.crop.x + (region.box.x + region.box.width) / fromUnit.scaleX;
  const naturalBottom = fromUnit.crop.y + (region.box.y + region.box.height) / fromUnit.scaleY;
  const left = clamp((naturalLeft - toUnit.crop.x) * toUnit.scaleX, 0, toUnit.pixelSize.width);
  const top = clamp((naturalTop - toUnit.crop.y) * toUnit.scaleY, 0, toUnit.pixelSize.height);
  const right = clamp((naturalRight - toUnit.crop.x) * toUnit.scaleX, 0, toUnit.pixelSize.width);
  const bottom = clamp((naturalBottom - toUnit.crop.y) * toUnit.scaleY, 0, toUnit.pixelSize.height);
  return {
    ...region,
    box: {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    },
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function createOcrTileError(cause: unknown, tileIndex: number, tileCount: number, unit: RecognitionUnit): Error {
  const { crop } = unit;
  const safeCause = createSafeOcrCause(cause);
  const message = `OCR tile ${tileIndex}/${tileCount} (x=${formatDiagnosticNumber(crop.x)},y=${formatDiagnosticNumber(crop.y)},w=${formatDiagnosticNumber(crop.width)},h=${formatDiagnosticNumber(crop.height)}) failed: ${safeCause.message}`;
  return new Error(message, { cause: safeCause });
}

function createOcrRescueError(cause: unknown, variant: OcrPreprocessVariantId, unit: RecognitionUnit): Error {
  const { crop } = unit;
  const safeCause = createSafeOcrCause(cause);
  const message = `OCR rescue (${variant}, unit x=${formatDiagnosticNumber(crop.x)},y=${formatDiagnosticNumber(crop.y)},w=${formatDiagnosticNumber(crop.width)},h=${formatDiagnosticNumber(crop.height)}) failed: ${safeCause.message}`;
  return new Error(message, { cause: safeCause });
}

function createSafeOcrCause(cause: unknown): Error {
  const safeCause = new Error(safeErrorMessage(cause));
  safeCause.name = "SafeOcrProviderError";
  return safeCause;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bimage[_-]?data\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s]+)/gi, "[redacted-image]")
    .replace(/data:[^\s"'<>)]*/gi, "[redacted-image]")
    .replace(/https?:\/\/[^\s"'<>)]*/gi, "[redacted-url]")
    .replace(
      /\b(authorization|proxy-authorization)\b\s*[:=]\s*(?:bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[redacted]",
    )
    .replace(/\bbearer\s+(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "Bearer [redacted]")
    .replace(
      /["']?\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|client[_-]?secret|secret)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[redacted]",
    )
    .slice(0, 500);
}

function formatDiagnosticNumber(value: number): string {
  return String(normalizeCacheNumber(value));
}

function buildTranslationItems(regions: GenericOcrRegion[]): TextTranslationItem[] {
  return regions.map((region, index) => ({
    id: region.id,
    text: region.sourceText,
    context: [
      `order ${index + 1}/${regions.length}`,
      `kind: ${region.kind}`,
      `orientation: ${region.orientation}`,
      `box: x=${Math.round(region.box.x)}, y=${Math.round(region.box.y)}, w=${Math.round(region.box.width)}, h=${Math.round(region.box.height)}`,
      index > 0 ? `previous: ${compactContextText(regions[index - 1]!.sourceText)}` : "",
      index < regions.length - 1 ? `next: ${compactContextText(regions[index + 1]!.sourceText)}` : "",
    ].filter(Boolean).join("; "),
  }));
}

function compactContextText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

function extractTermCandidates(regions: GenericOcrRegion[]): string[] {
  const counts = new Map<string, number>();
  for (const region of regions) {
    const text = region.sourceText.replace(/[’']/g, "'").replace(/[^A-Za-z0-9'\-\s]/g, " ");
    for (const candidate of candidateTermsFromText(text)) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([term, count]) => count > 1 || term.includes(" ") || /^[A-Z]{2,}$/.test(term) || isSingleNameCandidate(term))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .map(([term]) => term)
    .slice(0, 24);
}

function mergeUniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of terms) {
    const term = raw.replace(/\s+/g, " ").trim();
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    result.push(term);
    if (result.length >= 24) break;
  }
  return result;
}

function candidateTermsFromText(text: string): string[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const candidates: string[] = [];
  let phrase: string[] = [];
  const flush = () => {
    if (phrase.length) {
      if (phrase.length === 1) candidates.push(phrase[0]!);
      else {
        for (let start = 0; start < phrase.length; start += 1) {
          for (let end = start + 1; end <= Math.min(phrase.length, start + 4); end += 1) {
            const slice = phrase.slice(start, end);
            if (slice.length === 1 || slice.length >= 2) candidates.push(slice.join(" "));
          }
        }
      }
    }
    phrase = [];
  };
  for (const raw of tokens) {
    const token = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (!token) {
      flush();
      continue;
    }
    const proper = isLikelyProperToken(token);
    if (proper) phrase.push(token);
    else flush();
  }
  flush();
  return [...new Set(candidates.filter(isUsefulTermCandidate))];
}

const COMMON_CAPITALIZED_WORDS = new Set([
  "A", "An", "And", "Are", "As", "At", "But", "By", "Can", "Did", "Do", "Does", "For", "From", "Go", "Had", "Has", "Have", "He", "Her", "Here", "His", "How", "I", "If", "In", "Is", "It", "Me", "My", "No", "Not", "Of", "Oh", "On", "Or", "Our", "She", "So", "That", "The", "Then", "There", "They", "This", "To", "Was", "We", "What", "When", "Where", "Who", "Why", "Will", "With", "Yes", "You", "Your",
]);

function isLikelyProperToken(token: string): boolean {
  if (token.length < 2 || token.length > 32) return false;
  if (/^\d+$/.test(token)) return false;
  if (/^[A-Z]{2,}$/.test(token)) return true;
  return /^[A-Z][a-z0-9'\-]+$/.test(token);
}

function isUsefulTermCandidate(term: string): boolean {
  if (term.length < 3 || term.length > 64) return false;
  const parts = term.split(/\s+/);
  if (parts.length === 1 && COMMON_CAPITALIZED_WORDS.has(term)) return false;
  if (parts.every((part) => COMMON_CAPITALIZED_WORDS.has(part))) return false;
  return /[A-Za-z]/.test(term);
}

function isSingleNameCandidate(term: string): boolean {
  return /^[A-Z][a-z][A-Za-z'\-]{2,}$/.test(term) && !COMMON_CAPITALIZED_WORDS.has(term);
}

export function buildOcrCacheKey(
  profile: string,
  input: {
    imageHash: string;
    width: number;
    height: number;
    sourceLanguage: string;
    recognitionUnit?: RecognitionUnit;
    ocrVariant?: OcrPreprocessVariantId;
  },
): string {
  const base = {
    v: 1,
    ocrProfile: profile.split("+openai-compatible:")[0],
    imageHash: input.imageHash,
    width: input.width,
    height: input.height,
    sourceLanguage: input.sourceLanguage,
  };
  if (!input.recognitionUnit && !input.ocrVariant) return JSON.stringify(base);
  const unit = input.recognitionUnit;
  if (!unit) {
    return JSON.stringify({
      ...base,
      v: 3,
      ocrVariant: input.ocrVariant,
    });
  }
  if (!input.ocrVariant || input.ocrVariant === "original") {
    return JSON.stringify({
      ...base,
      v: 2,
      cropX: normalizeCacheNumber(unit.crop.x),
      cropY: normalizeCacheNumber(unit.crop.y),
      cropWidth: normalizeCacheNumber(unit.crop.width),
      cropHeight: normalizeCacheNumber(unit.crop.height),
      pixelWidth: normalizeCacheNumber(unit.pixelSize.width),
      pixelHeight: normalizeCacheNumber(unit.pixelSize.height),
      scaleX: normalizeCacheNumber(unit.scaleX),
      scaleY: normalizeCacheNumber(unit.scaleY),
      preprocessingVersion: unit.preprocessingVersion,
    });
  }
  return JSON.stringify({
    ...base,
    v: 3,
    cropX: normalizeCacheNumber(unit.crop.x),
    cropY: normalizeCacheNumber(unit.crop.y),
    cropWidth: normalizeCacheNumber(unit.crop.width),
    cropHeight: normalizeCacheNumber(unit.crop.height),
    pixelWidth: normalizeCacheNumber(unit.pixelSize.width),
    pixelHeight: normalizeCacheNumber(unit.pixelSize.height),
    scaleX: normalizeCacheNumber(unit.scaleX),
    scaleY: normalizeCacheNumber(unit.scaleY),
    preprocessingVersion: unit.preprocessingVersion,
    ocrVariant: input.ocrVariant,
  });
}

function normalizeCacheNumber(value: number): number {
  if (!Number.isFinite(value)) throw new Error("OCR cache key geometry must contain only finite numbers.");
  const normalized = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function groupOcrRegionsIntoTextBlocks(regions: GenericOcrRegion[]): GenericOcrRegion[] {
  return reconstructBubbles(regions).map(bubbleToOcrRegion);
}

function classifyRegionKind(region: GenericOcrRegion, imageWidth: number, imageHeight: number): GenericOcrRegion {
  if (region.kind !== "dialogue") return region;
  return looksLikeActionLettering(region, imageWidth, imageHeight) ? { ...region, kind: "sfx" } : region;
}

function looksLikeActionLettering(region: GenericOcrRegion, imageWidth: number, imageHeight: number): boolean {
  const text = region.sourceText.trim();
  const letters = Array.from(text).filter((char) => /\p{L}/u.test(char));
  if (!letters.length) return false;
  const uppercaseLetters = letters.filter((char) => char.toLocaleUpperCase() === char && char.toLocaleLowerCase() !== char).length;
  const uppercaseRatio = uppercaseLetters / letters.length;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const averageLineLength = lines.reduce((sum, line) => sum + Array.from(line.replace(/\s+/g, "")).length, 0) / Math.max(1, lines.length);
  const largeActionBox = region.box.height >= Math.max(220, imageHeight * 0.03) && region.box.width >= Math.max(220, imageWidth * 0.25);
  return largeActionBox && uppercaseRatio >= 0.78 && lines.length <= 4 && averageLineLength <= 9;
}

function bubbleToOcrRegion(bubble: ReturnType<typeof reconstructBubbles>[number]): GenericOcrRegion {
  return {
    id: bubble.id,
    box: bubble.box,
    sourceText: bubble.sourceText,
    confidence: bubble.confidence,
    orientation: bubble.orientation,
    kind: bubble.kind,
  };
}
