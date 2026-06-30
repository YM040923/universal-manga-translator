import test from "node:test";
import assert from "node:assert/strict";
import { mapNaturalBoxToRenderedBox, visibleRatio } from "./geometry.js";

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

