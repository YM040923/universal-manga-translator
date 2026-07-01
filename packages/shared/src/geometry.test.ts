import test from "node:test";
import assert from "node:assert/strict";
import { clampRectToBounds, isUsableRect, mapNaturalBoxToRenderedBox, visibleRatio } from "./geometry.js";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

test("maps natural image coordinates into rendered coordinates", () => {
  assert.deepEqual(
    mapNaturalBoxToRenderedBox(rect(100, 200, 300, 400), { width: 1000, height: 2000 }, rect(10, 20, 500, 1000)),
    rect(60, 120, 150, 200),
  );
});

test("computes visible ratio for a partially visible rectangle", () => {
  assert.equal(visibleRatio(rect(0, 0, 100, 100), rect(50, 0, 100, 100)), 0.5);
});



test("clamps natural boxes to image bounds", () => {
  assert.deepEqual(clampRectToBounds(rect(-10, 20, 50, 40), { width: 100, height: 100 }), rect(0, 20, 40, 40));
  assert.deepEqual(clampRectToBounds(rect(80, 80, 50, 50), { width: 100, height: 100 }), rect(80, 80, 20, 20));
});

test("rejects unusable natural boxes", () => {
  assert.equal(isUsableRect(rect(0, 0, 1, 20)), false);
  assert.equal(isUsableRect(rect(0, 0, 20, 1)), false);
  assert.equal(isUsableRect(rect(0, 0, 20, 20)), true);
});
