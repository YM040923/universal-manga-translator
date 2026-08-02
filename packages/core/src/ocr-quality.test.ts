import test from "node:test";
import assert from "node:assert/strict";
import type { OcrObservation, RecognitionUnit } from "@umt/shared";
import type { GenericOcrRegion } from "./generic-ocr.js";
import { assessOcrQuality, shouldAcceptRescue } from "./ocr-quality.js";

test("assessOcrQuality keeps normal readable text out of rescue", () => {
  const assessment = assessOcrQuality([
    region("r1", "Where are you going?", 0.94, 24, 32, 220, 38),
    region("r2", "I will be back before sunset.", 0.91, 24, 86, 310, 42),
  ], unit());

  assert.equal(assessment.suspicious, false);
  assert.deepEqual(assessment.reasons, []);
  assert.equal(assessment.score > 70, true);
});

test("assessOcrQuality explains low confidence, symbols, and fragmented OCR", () => {
  const assessment = assessOcrQuality([
    region("r1", "@#%", 0.21, 10, 20, 18, 18),
    region("r2", "A", 0.28, 32, 20, 12, 18),
    region("r3", "?", 0.19, 50, 20, 10, 18),
    region("r4", "B", 0.25, 66, 20, 12, 18),
  ], unit());

  assert.equal(assessment.suspicious, true);
  assert.equal(assessment.reasons.includes("low-confidence"), true);
  assert.equal(assessment.reasons.includes("high-symbol-ratio"), true);
  assert.equal(assessment.reasons.includes("fragmented-text"), true);
  assert.equal(assessment.metrics.regionCount, 4);
  assert.equal(assessment.metrics.shortFragmentCount, 3);
});

test("assessOcrQuality detects severe disagreement in overlapping tile observations", () => {
  const current: OcrObservation[] = [
    observation("current", "SILVER MOON", "tile-2", 0.88, 20, 920, 180, 40),
  ];
  const previous: OcrObservation[] = [
    observation("previous", "BLOOD ROOM", "tile-1", 0.9, 22, 922, 178, 38),
  ];

  const assessment = assessOcrQuality(current, unit("tile-2"), { overlappingObservations: previous });

  assert.equal(assessment.suspicious, true);
  assert.equal(assessment.reasons.includes("overlap-disagreement"), true);
  assert.equal(assessment.metrics.overlapDisagreementCount, 1);
});

test("assessOcrQuality does not pay for empty OCR without text evidence", () => {
  const assessment = assessOcrQuality([], unit());

  assert.equal(assessment.suspicious, false);
  assert.deepEqual(assessment.reasons, []);
  assert.equal(assessment.metrics.regionCount, 0);
});

test("assessOcrQuality allows empty OCR rescue with likely text evidence or manual selection", () => {
  const likely = assessOcrQuality([], unit(), { likelyTextEvidence: true });
  const manual = assessOcrQuality([], unit("manual", "manual-selection"));

  assert.equal(likely.suspicious, true);
  assert.deepEqual(likely.reasons, ["empty-with-text-evidence"]);
  assert.equal(manual.suspicious, true);
  assert.deepEqual(manual.reasons, ["empty-with-text-evidence"]);
});

test("assessOcrQuality accepts punctuation, common abbreviations, and split SFX fragments", () => {
  const punctuation = assessOcrQuality([
    region("punctuation", "!!!", 0.42, 20, 20, 36, 30),
  ], unit());
  const abbreviation = assessOcrQuality([
    region("abbreviation", "A.I.", 0.61, 20, 20, 48, 30),
  ], unit());
  const splitSfx = assessOcrQuality([
    region("b", "B", 0.93, 20, 20, 24, 28),
    region("a", "A", 0.91, 52, 28, 24, 28),
    region("m", "M", 0.94, 84, 36, 28, 30),
  ], unit());

  assert.equal(punctuation.suspicious, false);
  assert.equal(abbreviation.suspicious, false);
  assert.equal(splitSfx.reasons.includes("fragmented-text"), false);
  assert.equal(splitSfx.suspicious, false);
});

test("shouldAcceptRescue accepts similar text with a material confidence improvement", () => {
  const original = [region("original", "JOHN", 0.54, 20, 20, 100, 30)];
  const rescue = [region("rescue", "JOHN", 0.91, 20, 20, 100, 30)];

  assert.equal(shouldAcceptRescue(
    { observations: original, assessment: assessOcrQuality(original, unit()) },
    { observations: rescue, assessment: assessOcrQuality(rescue, unit()) },
  ), true);
});

test("shouldAcceptRescue accepts a clean structural improvement for suspicious OCR", () => {
  const original = [region("original", "H3LL?", 0.22, 20, 20, 100, 30)];
  const rescue = [region("rescue", "HELLO", 0.94, 20, 20, 100, 30)];

  assert.equal(shouldAcceptRescue(
    { observations: original, assessment: assessOcrQuality(original, unit()) },
    { observations: rescue, assessment: assessOcrQuality(rescue, unit()) },
  ), true);
});

test("shouldAcceptRescue rejects inflated, repetitive, or unrelated rescue text", () => {
  const original = [region("original", "JOHN", 0.48, 20, 20, 100, 30)];
  const inflated = [region("inflated", "JOHNNNNNNNNNN", 0.99, 20, 20, 180, 30)];
  const unrelated = [region("unrelated", "PRIVATE CASTLE", 0.99, 20, 20, 180, 30)];
  const originalCandidate = {
    observations: original,
    assessment: assessOcrQuality(original, unit()),
  };

  assert.equal(shouldAcceptRescue(originalCandidate, {
    observations: inflated,
    assessment: assessOcrQuality(inflated, unit()),
  }), false);
  assert.equal(shouldAcceptRescue(originalCandidate, {
    observations: unrelated,
    assessment: assessOcrQuality(unrelated, unit()),
  }), false);
});

test("assessOcrQuality does not reward extra characters or regions", () => {
  const compact = assessOcrQuality([
    region("compact", "JOHN", 0.9, 20, 20, 100, 30),
  ], unit());
  const inflated = assessOcrQuality([
    region("one", "JOHN", 0.9, 20, 20, 100, 30),
    region("two", "JOHN", 0.9, 20, 60, 100, 30),
    region("three", "JOHN", 0.9, 20, 100, 100, 30),
  ], unit());

  assert.equal(inflated.metrics.characterCount > compact.metrics.characterCount, true);
  assert.equal(inflated.metrics.regionCount > compact.metrics.regionCount, true);
  assert.equal(inflated.score, compact.score);
});

function unit(id = "tile-1", reason: RecognitionUnit["reason"] = "automatic"): RecognitionUnit {
  return {
    id,
    parentSurfaceId: "surface-1",
    crop: { x: 0, y: 0, width: 1000, height: 1000 },
    naturalSize: { width: 1000, height: 1000 },
    pixelSize: { width: 1000, height: 1000 },
    scaleX: 1,
    scaleY: 1,
    priority: "p0",
    reason,
    preprocessingVersion: "none-v1",
  };
}

function region(
  id: string,
  sourceText: string,
  confidence: number,
  x: number,
  y: number,
  width: number,
  height: number,
): GenericOcrRegion {
  return { id, sourceText, confidence, box: { x, y, width, height }, orientation: "horizontal", kind: "dialogue" };
}

function observation(
  id: string,
  sourceText: string,
  unitId: string,
  confidence: number,
  x: number,
  y: number,
  width: number,
  height: number,
): OcrObservation {
  return {
    ...region(id, sourceText, confidence, x, y, width, height),
    unitId,
    variant: "original",
    suspicious: false,
  };
}
