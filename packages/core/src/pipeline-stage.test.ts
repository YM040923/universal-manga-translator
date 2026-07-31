import test from "node:test";
import assert from "node:assert/strict";
import { isPipelineStage, toSafePipelineStageEvent, type PipelineStage } from "./index.js";

const stages: PipelineStage[] = [
  "idle",
  "queued",
  "capturing",
  "planning",
  "ocr",
  "ocr-rescue",
  "bubble-detection",
  "translating",
  "layout",
  "rendering",
  "completed",
  "cached",
  "empty",
  "failed",
  "cancelled",
];

test("isPipelineStage accepts every stable pipeline stage", () => {
  for (const stage of stages) assert.equal(isPipelineStage(stage), true);
  assert.equal(isPipelineStage("processing"), false);
  assert.equal(isPipelineStage(null), false);
});

test("toSafePipelineStageEvent preserves only the stage event whitelist", () => {
  const safe = toSafePipelineStageEvent({
    surfaceId: "surface-1",
    unitId: "unit-1",
    stage: "ocr",
    timestamp: 1_722_444_800_000,
    detail: "parsed 3 regions",
    elapsedMs: 125,
    imageData: "data:image/png;base64,secret",
    apiKey: "secret-key",
    authorization: "Bearer secret",
  });

  assert.deepEqual(safe, {
    surfaceId: "surface-1",
    unitId: "unit-1",
    stage: "ocr",
    timestamp: 1_722_444_800_000,
    detail: "parsed 3 regions",
    elapsedMs: 125,
  });
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes("imageData"), false);
  assert.equal(serialized.includes("secret-key"), false);
  assert.equal(serialized.includes("Bearer secret"), false);
});

test("toSafePipelineStageEvent rejects invalid required fields", () => {
  assert.throws(
    () => toSafePipelineStageEvent({ surfaceId: "surface-1", stage: "processing", timestamp: Date.now() }),
    TypeError,
  );
});
