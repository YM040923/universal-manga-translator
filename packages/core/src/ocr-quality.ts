import type { OcrObservation, RecognitionUnit, Rect } from "@umt/shared";
import type { GenericOcrRegion } from "./generic-ocr.js";

export type OcrQualityReason =
  | "low-confidence"
  | "high-symbol-ratio"
  | "fragmented-text"
  | "small-text"
  | "overlap-disagreement"
  | "empty-with-text-evidence";

export interface OcrQualityMetrics {
  regionCount: number;
  characterCount: number;
  averageConfidence: number;
  symbolRatio: number;
  shortFragmentCount: number;
  isolatedCharacterCount: number;
  overlapDisagreementCount: number;
  medianTextHeight: number;
}

export interface OcrQualityAssessment {
  suspicious: boolean;
  reasons: OcrQualityReason[];
  score: number;
  metrics: OcrQualityMetrics;
}

export interface AssessOcrQualityOptions {
  likelyTextEvidence?: boolean;
  overlappingObservations?: readonly OcrQualityInput[];
}

export type OcrQualityInput = GenericOcrRegion | OcrObservation;

export function assessOcrQuality(
  observations: readonly OcrQualityInput[],
  recognitionUnit: RecognitionUnit,
  options: AssessOcrQualityOptions = {},
): OcrQualityAssessment {
  const texts = observations.map((observation) => observation.sourceText.replace(/\s+/g, " ").trim()).filter(Boolean);
  const characters = texts.flatMap((text) => Array.from(text).filter((character) => !/\s/u.test(character)));
  const confidenceValues = observations.map((observation) => clamp01(observation.confidence));
  const averageConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, confidence) => sum + confidence, 0) / confidenceValues.length
    : 0;
  const symbolCount = characters.filter((character) => !/[\p{L}\p{N}]/u.test(character)).length;
  const shortFragmentCount = texts.filter((text) => Array.from(text.replace(/\s+/g, "")).length <= 2).length;
  const isolatedCharacterCount = texts.filter((text) => Array.from(text.replace(/\s+/g, "")).length === 1).length;
  const medianTextHeight = median(observations.map((observation) => observation.box.height).filter(isPositiveFinite));
  const overlapDisagreementCount = countOverlapDisagreements(observations, options.overlappingObservations ?? []);
  const symbolRatio = characters.length ? symbolCount / characters.length : 0;
  const reasons: OcrQualityReason[] = [];
  const hasTextEvidence = options.likelyTextEvidence === true || recognitionUnit.reason === "manual-selection";

  if (observations.length === 0) {
    if (hasTextEvidence) reasons.push("empty-with-text-evidence");
  } else {
    const veryLowConfidenceCount = confidenceValues.filter((confidence) => confidence < 0.45).length;
    if (averageConfidence < 0.58 || veryLowConfidenceCount >= Math.max(2, Math.ceil(observations.length / 2))) {
      reasons.push("low-confidence");
    }
    if (characters.length >= 3 && symbolRatio >= 0.45) reasons.push("high-symbol-ratio");
    if (shortFragmentCount >= 3 && shortFragmentCount >= Math.ceil(texts.length * 0.6)) reasons.push("fragmented-text");
    if (medianTextHeight > 0 && medianTextHeight <= 18 && averageConfidence < 0.8 && characters.length <= 48) reasons.push("small-text");
    if (overlapDisagreementCount > 0) reasons.push("overlap-disagreement");
  }

  const score = qualityScore({
    regionCount: observations.length,
    characterCount: characters.length,
    averageConfidence,
    symbolRatio,
    shortFragmentCount,
    isolatedCharacterCount,
    overlapDisagreementCount,
    medianTextHeight,
  }, reasons);
  return {
    suspicious: reasons.length > 0,
    reasons,
    score,
    metrics: {
      regionCount: observations.length,
      characterCount: characters.length,
      averageConfidence,
      symbolRatio,
      shortFragmentCount,
      isolatedCharacterCount,
      overlapDisagreementCount,
      medianTextHeight,
    },
  };
}

function qualityScore(metrics: OcrQualityMetrics, reasons: readonly OcrQualityReason[]): number {
  if (metrics.regionCount === 0) return 0;
  let score =
    metrics.averageConfidence * 55
    + Math.min(25, metrics.characterCount * 1.25)
    + Math.min(10, metrics.regionCount * 2)
    + (1 - metrics.symbolRatio) * 10;
  if (reasons.includes("fragmented-text")) score -= 15;
  if (reasons.includes("overlap-disagreement")) score -= 18 * metrics.overlapDisagreementCount;
  if (reasons.includes("small-text")) score -= 4;
  return round(clamp(score, 0, 100), 4);
}

function countOverlapDisagreements(
  observations: readonly OcrQualityInput[],
  peers: readonly OcrQualityInput[],
): number {
  let count = 0;
  for (const observation of observations) {
    const normalized = normalizeText(observation.sourceText);
    if (!normalized) continue;
    const disagrees = peers.some((peer) => {
      if (rectIoU(observation.box, peer.box) < 0.45) return false;
      const peerText = normalizeText(peer.sourceText);
      return peerText.length > 0 && normalized !== peerText && textSimilarity(normalized, peerText) < 0.35;
    });
    if (disagrees) count += 1;
  }
  return count;
}

function textSimilarity(a: string, b: string): number {
  const maximumLength = Math.max(a.length, b.length);
  if (maximumLength === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maximumLength;
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0]!;
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const above = previous[column]!;
      const substitution = diagonal + (a[row - 1] === b[column - 1] ? 0 : 1);
      previous[column] = Math.min(previous[column - 1]! + 1, above + 1, substitution);
      diagonal = above;
    }
  }
  return previous[b.length]!;
}

function normalizeText(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
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

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
