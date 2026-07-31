import test from "node:test";
import assert from "node:assert/strict";
import type { OcrObservation, RecognitionPriority, RecognitionUnit } from "./index.js";

test("RecognitionUnit is JSON-safe and preserves its contract fields", () => {
  const priority = "p0" satisfies RecognitionPriority;
  const unit = {
    id: "unit-1",
    parentSurfaceId: "surface-1",
    imageHash: "sha256:abc",
    crop: { x: 12, y: 34, width: 500, height: 700 },
    naturalSize: { width: 1200, height: 2400 },
    pixelSize: { width: 1000, height: 1400 },
    scaleX: 2,
    scaleY: 2,
    priority,
    reason: "manual-selection",
    preprocessingVersion: "preprocess-v1",
  } satisfies RecognitionUnit;

  assert.deepEqual(JSON.parse(JSON.stringify(unit)), unit);
});

test("OcrObservation is JSON-safe and preserves its contract fields", () => {
  const observation = {
    id: "observation-1",
    unitId: "unit-1",
    box: { x: 20, y: 30, width: 100, height: 40 },
    sourceText: "Hello",
    confidence: 0.94,
    orientation: "horizontal",
    kind: "dialogue",
    variant: "original",
    suspicious: false,
  } satisfies OcrObservation;

  assert.deepEqual(JSON.parse(JSON.stringify(observation)), observation);
});
