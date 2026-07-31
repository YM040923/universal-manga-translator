import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { DetectedSurface } from "../detector/surface-detector.js";
import { createRecognitionCapture, formatRecognitionCaptureSummary } from "./recognition-capture.js";
import { createScreenshotSurfaceCapture } from "./screenshot-crop.js";
import { createSurfaceTaskCapture } from "./surface-capture.js";

test("createRecognitionCapture describes an automatic full image in natural coordinates", () => {
  const capture = createRecognitionCapture({
    parentSurfaceId: "surface:page-1",
    imageData: "data:image/webp;base64,YWJj",
    naturalSize: { width: 1000, height: 1500 },
    pixelSize: { width: 1000, height: 1500 },
    priority: "p2",
    reason: "automatic",
    captureSource: "image-fetch",
    devicePixelRatio: 2,
  });

  assert.deepEqual(capture.unit.crop, { x: 0, y: 0, width: 1000, height: 1500 });
  assert.deepEqual(capture.unit.naturalSize, { width: 1000, height: 1500 });
  assert.deepEqual(capture.unit.pixelSize, { width: 1000, height: 1500 });
  assert.equal(capture.unit.scaleX, 1);
  assert.equal(capture.unit.scaleY, 1);
  assert.equal(capture.unit.priority, "p2");
  assert.equal(capture.unit.reason, "automatic");
  assert.equal(capture.mimeType, "image/webp");
  assert.equal(capture.byteLength, 3);
  assert.equal(capture.devicePixelRatio, 2);
  assert.equal(capture.captureSource, "image-fetch");
});

test("automatic and manual captures share equivalent crop mapping metadata", () => {
  const common = {
    parentSurfaceId: "surface:page-1",
    imageData: "data:image/png;base64,YWJj",
    naturalSize: { width: 1200, height: 2400 },
    crop: { x: 100, y: 200, width: 400, height: 600 },
    pixelSize: { width: 800, height: 1200 },
    devicePixelRatio: 2,
  } as const;
  const automatic = createRecognitionCapture({
    ...common,
    priority: "p2",
    reason: "automatic",
    captureSource: "image-fetch",
  });
  const manual = createRecognitionCapture({
    ...common,
    priority: "p0",
    reason: "manual-selection",
    captureSource: "manual-selection",
  });

  assert.deepEqual(
    pickCoordinateMetadata(automatic.unit),
    pickCoordinateMetadata(manual.unit),
  );
});

test("automatic full image and manual full screenshot selection use the same OCR pixel coordinate space", async () => {
  const dom = new JSDOM("<body></body>", { url: "https://reader.example/chapter/1" });
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "location", { value: dom.window.location, configurable: true });
  Object.defineProperty(globalThis, "devicePixelRatio", { value: 2, configurable: true });
  const automaticSurface: DetectedSurface = {
    surfaceId: "automatic:1000x2000",
    kind: "canvas",
    element: document.body,
    imageData: "data:image/png;base64,YWJj",
    rect: { x: 0, y: 0, width: 500, height: 1000 },
    naturalSize: { width: 1000, height: 2000 },
    score: 10,
  };

  const automatic = createSurfaceTaskCapture(automaticSurface, "p2").capture;
  const manual = (await createScreenshotSurfaceCapture({
    screenshotDataUrl: "data:image/png;base64,full",
    viewportRect: { x: 0, y: 0, width: 500, height: 1000 },
    viewportSize: { width: 500, height: 1000 },
    screenshotSize: { width: 1000, height: 2000 },
    devicePixelRatio: 2,
    surfaceId: "manual:1000x2000",
    element: document.body,
    cropper: async () => "data:image/png;base64,YWJj",
  })).capture;

  assert.deepEqual(
    pickCoordinateMetadata(manual.unit),
    pickCoordinateMetadata(automatic.unit),
  );
  assert.equal(manual.devicePixelRatio, 2);
  assert.equal(manual.viewportScaleX, 2);
  assert.equal(manual.viewportScaleY, 2);
});

test("formatRecognitionCaptureSummary excludes image data and secret-like payloads", () => {
  const capture = createRecognitionCapture({
    parentSurfaceId: "surface:secret",
    imageData: "data:image/png;base64,API_KEY_super-secret-value",
    naturalSize: { width: 500, height: 800 },
    crop: { x: 10, y: 20, width: 100, height: 200 },
    pixelSize: { width: 200, height: 400 },
    priority: "p0",
    reason: "manual-selection",
    captureSource: "manual-selection",
    devicePixelRatio: 2,
  });

  const summary = formatRecognitionCaptureSummary(capture);

  assert.match(summary, /source=manual-selection/);
  assert.match(summary, /mime=image\/png/);
  assert.match(summary, /dpr=2/);
  assert.match(summary, /natural=500x800/);
  assert.match(summary, /pixel=200x400/);
  assert.match(summary, /crop=10,20,100x200/);
  assert.match(summary, /bytes=/);
  assert.doesNotMatch(summary, /imageData|base64|API_KEY|super-secret-value/);
});

function pickCoordinateMetadata(unit: {
  crop: unknown;
  naturalSize: unknown;
  pixelSize: unknown;
  scaleX: number;
  scaleY: number;
}): unknown {
  return {
    crop: unit.crop,
    naturalSize: unit.naturalSize,
    pixelSize: unit.pixelSize,
    scaleX: unit.scaleX,
    scaleY: unit.scaleY,
  };
}
