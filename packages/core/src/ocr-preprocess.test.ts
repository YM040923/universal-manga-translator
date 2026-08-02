import test from "node:test";
import assert from "node:assert/strict";
import type { RecognitionUnit } from "@umt/shared";
import {
  OCR_PREPROCESS_VARIANTS,
  applyOcrPreprocessVariantToUnit,
  getOcrPreprocessVariant,
  selectOcrRescueVariant,
} from "./ocr-preprocess.js";
import type { OcrQualityAssessment } from "./ocr-quality.js";

test("OCR preprocess variants expose stable DOM-free ids, versions, and cache keys", () => {
  assert.deepEqual(Object.keys(OCR_PREPROCESS_VARIANTS), [
    "original",
    "lossless-normalized",
    "upscale-2x",
    "grayscale-contrast",
    "adaptive-threshold",
  ]);
  for (const variant of Object.values(OCR_PREPROCESS_VARIANTS)) {
    assert.match(variant.version, /^ocr-preprocess:[a-z0-9-]+:v1$/);
    assert.equal(variant.cacheKey, variant.version);
    assert.equal(JSON.stringify(variant).includes("document"), false);
    assert.equal(JSON.stringify(variant).includes("canvas"), false);
  }
});

test("applyOcrPreprocessVariantToUnit updates upscale geometry without changing natural crop coordinates", () => {
  const source = unit();
  const transformed = applyOcrPreprocessVariantToUnit(source, getOcrPreprocessVariant("upscale-2x"));

  assert.deepEqual(transformed.crop, source.crop);
  assert.deepEqual(transformed.pixelSize, { width: 2000, height: 1000 });
  assert.equal(transformed.scaleX, 2);
  assert.equal(transformed.scaleY, 2);
  assert.equal(transformed.reason, "ocr-rescue");
  assert.equal(transformed.preprocessingVersion, "ocr-preprocess:upscale-2x:v1");
});

test("selectOcrRescueVariant uses a conservative single-variant priority", () => {
  assert.equal(selectOcrRescueVariant(assessment(["low-confidence"])), "grayscale-contrast");
  assert.equal(selectOcrRescueVariant(assessment(["fragmented-text", "small-text"])), "grayscale-contrast");
  assert.equal(selectOcrRescueVariant(assessment(["small-text"])), "upscale-2x");
  assert.equal(selectOcrRescueVariant(assessment(["empty-with-text-evidence"])), "adaptive-threshold");
  assert.equal(selectOcrRescueVariant(assessment([])), null);
});

function assessment(reasons: OcrQualityAssessment["reasons"]): OcrQualityAssessment {
  return {
    suspicious: reasons.length > 0,
    reasons,
    score: 10,
    metrics: {
      regionCount: 0,
      characterCount: 0,
      averageConfidence: 0,
      symbolRatio: 0,
      shortFragmentCount: 0,
      isolatedCharacterCount: 0,
      overlapDisagreementCount: 0,
      medianTextHeight: 0,
    },
  };
}

function unit(): RecognitionUnit {
  return {
    id: "tile-1",
    parentSurfaceId: "surface-1",
    crop: { x: 100, y: 200, width: 1000, height: 500 },
    naturalSize: { width: 1200, height: 2000 },
    pixelSize: { width: 1000, height: 500 },
    scaleX: 1,
    scaleY: 1,
    priority: "p0",
    reason: "automatic",
    preprocessingVersion: "none-v1",
  };
}
