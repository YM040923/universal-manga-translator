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

test("toSafePipelineStageEvent requires required fields to be own properties", () => {
  const inherited = Object.create({
    surfaceId: "surface-1",
    stage: "ocr",
    timestamp: 100,
  });

  assert.throws(() => toSafePipelineStageEvent(inherited), TypeError);
});

test("toSafePipelineStageEvent ignores inherited optional fields", () => {
  const input = Object.assign(
    Object.create({ unitId: "inherited-unit", detail: "inherited detail", elapsedMs: 50 }),
    { surfaceId: "surface-1", stage: "ocr", timestamp: 100 },
  );

  assert.deepEqual(toSafePipelineStageEvent(input), {
    surfaceId: "surface-1",
    stage: "ocr",
    timestamp: 100,
  });
});

test("toSafePipelineStageEvent reads each allowed property only once", () => {
  const reads = new Map<string, number>();
  const changing = <T>(key: string, first: T, later: unknown) => ({
    enumerable: true,
    get() {
      const count = (reads.get(key) ?? 0) + 1;
      reads.set(key, count);
      return count === 1 ? first : later;
    },
  });
  const input = Object.defineProperties({}, {
    surfaceId: changing("surfaceId", "surface-1", 123),
    stage: changing("stage", "ocr", "processing"),
    timestamp: changing("timestamp", 100, -1),
    unitId: changing("unitId", "unit-1", 123),
    detail: changing("detail", "parsed 3 regions", {}),
    elapsedMs: changing("elapsedMs", 25, -1),
  });

  assert.deepEqual(toSafePipelineStageEvent(input), {
    surfaceId: "surface-1",
    stage: "ocr",
    timestamp: 100,
    unitId: "unit-1",
    detail: "parsed 3 regions",
    elapsedMs: 25,
  });
  assert.deepEqual(Object.fromEntries(reads), {
    surfaceId: 1,
    stage: 1,
    timestamp: 1,
    unitId: 1,
    detail: 1,
    elapsedMs: 1,
  });
});

test("toSafePipelineStageEvent rejects invalid timestamps", () => {
  for (const timestamp of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
    assert.throws(
      () => toSafePipelineStageEvent({ surfaceId: "surface-1", stage: "ocr", timestamp }),
      TypeError,
    );
  }
});

test("toSafePipelineStageEvent rejects invalid elapsed times", () => {
  for (const elapsedMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
    assert.throws(
      () => toSafePipelineStageEvent({ surfaceId: "surface-1", stage: "ocr", timestamp: 100, elapsedMs }),
      TypeError,
    );
  }
});

test("toSafePipelineStageEvent rejects invalid optional fields", () => {
  assert.throws(
    () => toSafePipelineStageEvent({ surfaceId: "surface-1", stage: "ocr", timestamp: 100, unitId: 123 }),
    TypeError,
  );
  assert.throws(
    () => toSafePipelineStageEvent({ surfaceId: "surface-1", stage: "ocr", timestamp: 100, detail: {} }),
    TypeError,
  );
  assert.throws(
    () => toSafePipelineStageEvent({ surfaceId: "surface-1", stage: "ocr", timestamp: 100, elapsedMs: "25" }),
    TypeError,
  );
});
