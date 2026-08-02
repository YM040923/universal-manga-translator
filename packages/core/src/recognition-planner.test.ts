import test from "node:test";
import assert from "node:assert/strict";
import { MAX_RECOGNITION_UNITS, planRecognitionUnits } from "./recognition-planner.js";

test("planRecognitionUnits keeps short images as one full-image unit", () => {
  const plan = planRecognitionUnits({
    surfaceId: "surface:short",
    naturalSize: { width: 1200, height: 3000 },
    maxTileHeight: 4096,
    overlapRatio: 0.125,
    reason: "automatic",
  });

  assert.equal(plan.units.length, 1);
  assert.deepEqual(plan.units[0]?.crop, { x: 0, y: 0, width: 1200, height: 3000 });
  assert.deepEqual(plan.units[0]?.naturalSize, { width: 1200, height: 3000 });
  assert.deepEqual(plan.units[0]?.pixelSize, { width: 1200, height: 3000 });
  assert.equal(plan.units[0]?.scaleX, 1);
  assert.equal(plan.units[0]?.scaleY, 1);
});

test("planRecognitionUnits splits a 16000px webtoon into ordered overlapping units", () => {
  const plan = planRecognitionUnits({
    surfaceId: "surface:tall",
    naturalSize: { width: 1200, height: 16000 },
    maxTileHeight: 4096,
    overlapRatio: 0.125,
    reason: "automatic",
  });

  assert.equal(plan.units.length > 1, true);
  assert.equal(plan.overlapPx, 512);
  assert.equal(plan.units[0]?.crop.y, 0);
  assert.equal(plan.units[0]?.priority, "p0");
  assert.deepEqual(plan.units.map((unit) => unit.crop.y), [...plan.units].map((unit) => unit.crop.y).sort((a, b) => a - b));

  for (const [index, unit] of plan.units.entries()) {
    assert.equal(Number.isFinite(unit.crop.x), true);
    assert.equal(Number.isFinite(unit.crop.y), true);
    assert.equal(Number.isFinite(unit.crop.width), true);
    assert.equal(Number.isFinite(unit.crop.height), true);
    assert.equal(unit.crop.width > 0, true);
    assert.equal(unit.crop.height > 0, true);
    assert.equal(unit.crop.y + unit.crop.height <= 16000, true);
    assert.deepEqual(unit.naturalSize, { width: 1200, height: 16000 });
    assert.deepEqual(unit.pixelSize, { width: unit.crop.width, height: unit.crop.height });
    if (index > 0) {
      const previous = plan.units[index - 1]!;
      assert.equal(unit.crop.y <= previous.crop.y + previous.crop.height, true, "tiles must not leave a gap");
      assert.equal(unit.crop.y < previous.crop.y + previous.crop.height, true, "tall-image tiles must overlap");
    }
  }

  const last = plan.units.at(-1)!;
  assert.equal(last.crop.y + last.crop.height, 16000);
});

test("planRecognitionUnits does not add a redundant overlap-only tail tile", () => {
  const plan = planRecognitionUnits({
    surfaceId: "surface:threshold-edge",
    naturalSize: { width: 1200, height: 7201 },
    maxTileHeight: 4096,
    overlapRatio: 0.125,
    reason: "automatic",
  });

  assert.equal(plan.units.length, 2);
  assert.equal(plan.units.at(-1)!.crop.y + plan.units.at(-1)!.crop.height, 7201);
});

test("planRecognitionUnits accepts safe integer bounds and rejects unsafe or non-finite parameters", () => {
  assert.equal(planRecognitionUnits({
    surfaceId: "surface:max-safe",
    naturalSize: { width: Number.MAX_SAFE_INTEGER, height: 1 },
    maxTileHeight: 1,
    overlapRatio: 0,
    reason: "automatic",
  }).units.length, 1);

  assert.throws(() => planRecognitionUnits({
    surfaceId: "surface:unsafe",
    naturalSize: { width: Number.MAX_SAFE_INTEGER + 1, height: 100 },
    maxTileHeight: 100,
    overlapRatio: 0,
    reason: "automatic",
  }), /safe integer/i);
  assert.throws(() => planRecognitionUnits({
    surfaceId: "surface:infinite-overlap",
    naturalSize: { width: 100, height: 100 },
    maxTileHeight: 100,
    overlapRatio: Number.POSITIVE_INFINITY,
    reason: "automatic",
  }), /overlapRatio.*finite/i);
});

test("planRecognitionUnits rejects plans above the hard unit limit before allocating tiles", () => {
  const maxTileHeight = 100;
  const height = (MAX_RECOGNITION_UNITS + 1) * maxTileHeight;

  assert.throws(() => planRecognitionUnits({
    surfaceId: "surface:too-many",
    naturalSize: { width: 1000, height },
    maxTileHeight,
    overlapRatio: 0,
    reason: "automatic",
  }), new RegExp(`${MAX_RECOGNITION_UNITS + 1}.*maximum.*${MAX_RECOGNITION_UNITS}`, "i"));
});
