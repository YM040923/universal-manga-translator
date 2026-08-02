import type { RecognitionUnit } from "@umt/shared";
import type { OcrQualityAssessment } from "./ocr-quality.js";

export type OcrPreprocessVariantId =
  | "original"
  | "lossless-normalized"
  | "upscale-2x"
  | "grayscale-contrast"
  | "adaptive-threshold";

export interface OcrPreprocessVariant {
  id: OcrPreprocessVariantId;
  version: string;
  cacheKey: string;
  scale: number;
  grayscale: boolean;
  contrast: number;
  threshold: "none" | "adaptive";
}

function variant(
  id: OcrPreprocessVariantId,
  options: Partial<Omit<OcrPreprocessVariant, "id" | "version" | "cacheKey">> = {},
): OcrPreprocessVariant {
  const version = `ocr-preprocess:${id}:v1`;
  return Object.freeze({
    id,
    version,
    cacheKey: version,
    scale: options.scale ?? 1,
    grayscale: options.grayscale ?? false,
    contrast: options.contrast ?? 1,
    threshold: options.threshold ?? "none",
  });
}

export const OCR_PREPROCESS_VARIANTS: Readonly<Record<OcrPreprocessVariantId, OcrPreprocessVariant>> = Object.freeze({
  original: variant("original"),
  "lossless-normalized": variant("lossless-normalized"),
  "upscale-2x": variant("upscale-2x", { scale: 2 }),
  "grayscale-contrast": variant("grayscale-contrast", { grayscale: true, contrast: 1.45 }),
  "adaptive-threshold": variant("adaptive-threshold", { grayscale: true, contrast: 1.25, threshold: "adaptive" }),
});

export function getOcrPreprocessVariant(id: OcrPreprocessVariantId): OcrPreprocessVariant {
  return OCR_PREPROCESS_VARIANTS[id];
}

export function selectOcrRescueVariant(assessment: OcrQualityAssessment): OcrPreprocessVariantId | null {
  if (!assessment.suspicious) return null;
  if (assessment.reasons.includes("empty-with-text-evidence")) return "adaptive-threshold";
  if (
    assessment.reasons.includes("low-confidence")
    || assessment.reasons.includes("fragmented-text")
    || assessment.reasons.includes("high-symbol-ratio")
    || assessment.reasons.includes("overlap-disagreement")
  ) {
    return "grayscale-contrast";
  }
  if (assessment.reasons.includes("small-text")) return "upscale-2x";
  return null;
}

export function applyOcrPreprocessVariantToUnit(
  unit: RecognitionUnit,
  variant: OcrPreprocessVariant,
): RecognitionUnit {
  if (variant.id === "original") return { ...unit };
  const crop = { ...unit.crop };
  return {
    ...unit,
    crop,
    pixelSize: {
      width: Math.max(1, Math.round(crop.width * unit.scaleX * variant.scale)),
      height: Math.max(1, Math.round(crop.height * unit.scaleY * variant.scale)),
    },
    scaleX: unit.scaleX * variant.scale,
    scaleY: unit.scaleY * variant.scale,
    reason: "ocr-rescue",
    preprocessingVersion: variant.version,
  };
}
