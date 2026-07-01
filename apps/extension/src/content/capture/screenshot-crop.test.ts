import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { clampCropRectToImage, createScreenshotSurface, type ScreenshotCropRect } from "./screenshot-crop.js";

test("clampCropRectToImage maps viewport rect to device pixels", () => {
  const crop = clampCropRectToImage(
    { x: 10, y: 20, width: 100, height: 80 },
    { width: 400, height: 300 },
    { width: 800, height: 600 },
  );

  assert.deepEqual(crop, { x: 20, y: 40, width: 200, height: 160 });
});

test("clampCropRectToImage clamps crop to screenshot bounds", () => {
  const crop = clampCropRectToImage(
    { x: -10, y: 250, width: 80, height: 100 },
    { width: 400, height: 300 },
    { width: 800, height: 600 },
  );

  assert.deepEqual(crop, { x: 0, y: 500, width: 140, height: 100 });
});

test("createScreenshotSurface builds a manual screenshot surface", async () => {
  const dom = new JSDOM("<body></body>");
  globalThis.document = dom.window.document;
  const calls: ScreenshotCropRect[] = [];
  const surface = await createScreenshotSurface({
    screenshotDataUrl: "data:image/png;base64,full",
    viewportRect: { x: 50, y: 100, width: 200, height: 300 },
    viewportSize: { width: 500, height: 1000 },
    screenshotSize: { width: 1000, height: 2000 },
    surfaceId: "manual:1",
    element: document.body,
    cropper: async (_image: string, crop: ScreenshotCropRect) => {
      calls.push(crop);
      return "data:image/png;base64,crop";
    },
  });

  assert.equal(surface.surfaceId, "manual:1");
  assert.equal(surface.kind, "screenshot");
  assert.equal(surface.imageData, "data:image/png;base64,crop");
  assert.deepEqual(surface.naturalSize, { width: 400, height: 600 });
  assert.deepEqual(surface.rect, { x: 50, y: 100, width: 200, height: 300 });
  assert.deepEqual(calls[0], { x: 100, y: 200, width: 400, height: 600 });
});
