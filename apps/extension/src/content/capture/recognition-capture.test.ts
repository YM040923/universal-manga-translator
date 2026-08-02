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

test("createRecognitionCapture parses data URL bytes and MIME without trusting header text", () => {
  const cases = [
    {
      imageData: "data:image/png;base64,YQ%3D%3D",
      expectedMimeType: "image/png",
      expectedByteLength: 1,
    },
    {
      imageData: "data:application/octet-stream,%89PNG",
      expectedMimeType: "application/octet-stream",
      expectedByteLength: 4,
    },
    {
      imageData: "DATA:image/png;base64,YQ==",
      expectedMimeType: "image/png",
      expectedByteLength: 1,
    },
    {
      imageData: "data:image/png;BASE64,YQ==",
      expectedMimeType: "image/png",
      expectedByteLength: 1,
    },
    {
      imageData: "data:IMAGE/PNG;name=secret\r\nheader;base64,YQ==",
      expectedMimeType: "image/png",
      expectedByteLength: 1,
    },
  ] as const;

  for (const { imageData, expectedMimeType, expectedByteLength } of cases) {
    const capture = createRecognitionCapture({
      parentSurfaceId: "surface:data-url",
      imageData,
      naturalSize: { width: 1, height: 1 },
      pixelSize: { width: 1, height: 1 },
      priority: "p2",
      reason: "automatic",
      captureSource: "inline-image-data",
    });

    assert.equal(capture.mimeType, expectedMimeType);
    assert.equal(capture.byteLength, expectedByteLength);
  }
});

test("createRecognitionCapture rejects invalid or truncated base64 payloads", () => {
  for (const imageData of [
    "data:image/png;base64,YQ=",
    "data:image/png;base64,YQ===",
    "data:image/png;base64,Y?==",
    "data:image/png;base64,%8",
  ]) {
    assert.throws(
      () => createRecognitionCapture({
        parentSurfaceId: "surface:invalid-base64",
        imageData,
        naturalSize: { width: 1, height: 1 },
        pixelSize: { width: 1, height: 1 },
        priority: "p2",
        reason: "automatic",
        captureSource: "inline-image-data",
      }),
      /invalid base64 image data/i,
    );
  }
});

test("createRecognitionCapture validates coordinate and diagnostic metadata", () => {
  const validInput = {
    parentSurfaceId: "surface:validation",
    imageData: "data:image/png;base64,YQ==",
    naturalSize: { width: 100, height: 200 },
    pixelSize: { width: 20, height: 40 },
    crop: { x: 10, y: 20, width: 20, height: 40 },
    priority: "p0",
    reason: "manual-selection",
    captureSource: "manual-selection",
  } as const;
  const invalidCases: Array<{ patch: Record<string, unknown>; message: RegExp }> = [
    { patch: { naturalSize: { width: Number.NaN, height: 200 } }, message: /naturalSize\.width.*finite/i },
    { patch: { naturalSize: { width: 0, height: 200 } }, message: /naturalSize\.width.*greater than 0/i },
    { patch: { pixelSize: { width: 20, height: Number.POSITIVE_INFINITY } }, message: /pixelSize\.height.*finite/i },
    { patch: { crop: { x: -1, y: 20, width: 20, height: 40 } }, message: /crop\.x.*at least 0/i },
    { patch: { crop: { x: 90, y: 20, width: 20, height: 40 } }, message: /crop.*naturalSize/i },
    {
      patch: {
        naturalSize: { width: Number.MAX_VALUE, height: 200 },
        pixelSize: { width: Number.MAX_VALUE, height: 40 },
        crop: { x: 0, y: 20, width: Number.MIN_VALUE, height: 40 },
      },
      message: /scaleX.*finite.*greater than 0/i,
    },
    { patch: { viewportScaleX: 2 }, message: /viewportScaleX.*viewportScaleY.*together/i },
    { patch: { viewportScaleX: 2, viewportScaleY: 0 }, message: /viewportScaleY.*greater than 0/i },
  ];

  for (const { patch, message } of invalidCases) {
    assert.throws(
      () => createRecognitionCapture({ ...validInput, ...patch }),
      message,
    );
  }
});

test("createRecognitionCapture sanitizes explicit MIME values", () => {
  const createWithMime = (mimeType: string) => createRecognitionCapture({
    parentSurfaceId: "surface:mime",
    imageData: "data:image/png;base64,YQ==",
    mimeType,
    naturalSize: { width: 1, height: 1 },
    pixelSize: { width: 1, height: 1 },
    priority: "p2",
    reason: "automatic",
    captureSource: "inline-image-data",
  });

  assert.equal(createWithMime("IMAGE/PNG; charset=utf-8").mimeType, "image/png");
  const invalid = createWithMime("image/png\r\nx-secret: leaked");
  assert.equal(invalid.mimeType, "application/octet-stream");
  assert.doesNotMatch(formatRecognitionCaptureSummary(invalid), /x-secret|leaked/i);
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
    imageData: "data:image/png;base64,QVBJX0tFWV9zdXBlci1zZWNyZXQtdmFsdWU=",
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
