import test from "node:test";
import assert from "node:assert/strict";
import type { OcrObservation, RecognitionUnit } from "@umt/shared";
import type { GenericOcrRegion } from "./generic-ocr.js";
import { assessOcrQuality } from "./ocr-quality.js";

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
