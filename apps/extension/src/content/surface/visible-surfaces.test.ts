import test from "node:test";
import assert from "node:assert/strict";
import { selectVisibleSurfaces } from "./visible-surfaces.js";
import type { RegisteredSurface } from "./surface-registry.js";

function surface(index: number, top: number, height = 1000): RegisteredSurface {
  return {
    index,
    surfaceId: `s${index}`,
    imageUrl: `https://cdn.example/${index}.webp`,
    rect: { x: 0, y: top, width: 800, height },
    naturalSize: { width: 800, height },
    element: {
      getBoundingClientRect: () => ({ top, bottom: top + height, left: 0, right: 800, x: 0, y: top, width: 800, height, toJSON: () => ({}) }),
    } as unknown as HTMLElement,
  };
}

test("selectVisibleSurfaces keeps only viewport-near chapter images in reading order", () => {
  const selected = selectVisibleSurfaces([
    surface(1, -2200),
    surface(4, 1800),
    surface(2, -200),
    surface(3, 700),
  ], { innerHeight: 900 }, 320);

  assert.deepEqual(selected.map((item) => item.surfaceId), ["s2", "s3"]);
});
