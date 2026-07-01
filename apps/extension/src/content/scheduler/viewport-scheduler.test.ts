import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { prioritizeSurfaces, selectSurfacesForMode } from "./viewport-scheduler.js";

const dom = new JSDOM(`<body></body>`);
const surface = (surfaceId: string, y: number) => ({
  surfaceId,
  kind: "image" as const,
  element: dom.window.document.createElement("img"),
  imageUrl: `/${surfaceId}.jpg`,
  rect: { x: 0, y, width: 800, height: 1000 },
  naturalSize: { width: 800, height: 1000 },
  score: 10,
});

test("assigns p0 to visible surfaces and p1 to nearby surfaces", () => {
  const result = prioritizeSurfaces([surface("visible", 100), surface("near", 900), surface("far", 5000)], { x: 0, y: 0, width: 1000, height: 800 });
  assert.deepEqual(result.map((item) => [item.surface.surfaceId, item.priority]), [["visible", "p0"], ["near", "p1"], ["far", "p2"]]);
});

test("orders visible pages before prefetch pages by distance", () => {
  const result = prioritizeSurfaces([
    surface("far-prefetch", 2100),
    surface("visible", 100),
    surface("near-prefetch", 850),
  ], { x: 0, y: 0, width: 1000, height: 800 });

  assert.deepEqual(result.map((item) => item.surface.surfaceId), ["visible", "near-prefetch", "far-prefetch"]);
});

test("selects only visible surfaces unless pretranslation is enabled", () => {
  const prioritized = prioritizeSurfaces([surface("visible", 100), surface("near", 900), surface("far", 5000)], { x: 0, y: 0, width: 1000, height: 800 });

  assert.deepEqual(selectSurfacesForMode(prioritized, { imageRange: "viewport", maxFullPageSurfaces: 80, pretranslateNextPage: false }).map((item) => item.surface.surfaceId), ["visible"]);
  assert.deepEqual(selectSurfacesForMode(prioritized, { imageRange: "viewport", maxFullPageSurfaces: 80, pretranslateNextPage: true }).map((item) => item.surface.surfaceId), ["visible", "near"]);
});
