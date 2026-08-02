import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { DetectedSurface } from "../detector/surface-detector.js";
import {
  createSurfaceTask,
  createSurfaceTaskCapture,
  createSurfaceTaskWithImageData,
  createSurfaceTaskWithImageDataCapture,
} from "./surface-capture.js";

type CapturePriority = Parameters<typeof createSurfaceTaskCapture>[1];
const acceptedCapturePriority = "p2" satisfies CapturePriority;
// @ts-expect-error background-only p3 must not enter recognition capture
const rejectedCapturePriority: CapturePriority = "p3";
void acceptedCapturePriority;
void rejectedCapturePriority;

test("createSurfaceTask sends image surfaces by URL", () => {
  installLocation("https://reader.example/chapter/1");
  const dom = new JSDOM(`<img id="page" />`);
  const surface: DetectedSurface = {
    surfaceId: "img:1:https://cdn.example/page.jpg",
    kind: "image",
    element: dom.window.document.querySelector<HTMLElement>("#page")!,
    imageUrl: "https://cdn.example/page.jpg",
    rect: { x: 1, y: 2, width: 800, height: 1200 },
    naturalSize: { width: 1000, height: 1500 },
    score: 10,
  };

  const task = createSurfaceTask(surface, "p0", "ja");

  assert.equal(task.imageUrl, "https://cdn.example/page.jpg");
  assert.equal("imageData" in task, false);
  assert.equal(task.domain, "reader.example");
  assert.equal(task.targetLanguage, "ja");
});

test("createSurfaceTaskCapture builds automatic recognition metadata for a full image", () => {
  installLocation("https://reader.example/chapter/1");
  installDevicePixelRatio(2);
  const dom = new JSDOM(`<canvas id="page"></canvas>`);
  const surface: DetectedSurface = {
    surfaceId: "canvas:1:1000x1500",
    kind: "canvas",
    element: dom.window.document.querySelector<HTMLElement>("#page")!,
    imageData: "data:image/png;base64,YWJj",
    rect: { x: 1, y: 2, width: 800, height: 1200 },
    naturalSize: { width: 1000, height: 1500 },
    score: 10,
  };

  const result = createSurfaceTaskCapture(surface, "p1", "zh-CN");

  assert.equal(result.task.imageData, surface.imageData);
  assert.deepEqual(result.capture.unit.crop, { x: 0, y: 0, width: 1000, height: 1500 });
  assert.deepEqual(result.capture.unit.naturalSize, surface.naturalSize);
  assert.deepEqual(result.capture.unit.pixelSize, surface.naturalSize);
  assert.equal(result.capture.unit.priority, "p1");
  assert.equal(result.capture.unit.reason, "automatic");
  assert.equal(result.capture.captureSource, "inline-image-data");
  assert.equal(result.capture.devicePixelRatio, 2);
});

test("createSurfaceTask sends canvas fallback surfaces by image data", () => {
  installLocation("https://reader.example/chapter/1");
  const dom = new JSDOM(`<canvas id="page"></canvas>`);
  const surface: DetectedSurface = {
    surfaceId: "canvas:1:900x1300",
    kind: "canvas",
    element: dom.window.document.querySelector<HTMLElement>("#page")!,
    imageData: "data:image/png;base64,abc123",
    rect: { x: 1, y: 2, width: 900, height: 1300 },
    naturalSize: { width: 900, height: 1300 },
    score: 10,
  };

  const task = createSurfaceTask(surface, "p1");

  assert.equal(task.imageData, "data:image/png;base64,abc123");
  assert.equal("imageUrl" in task, false);
});

function installLocation(url: string): void {
  const dom = new JSDOM(``, { url });
  Object.defineProperty(globalThis, "location", { value: dom.window.location, configurable: true });
}

function installDevicePixelRatio(value: number): void {
  Object.defineProperty(globalThis, "devicePixelRatio", { value, configurable: true });
}

test("createSurfaceTaskWithImageData prefers extension-fetched image data over backend URL fetch", async () => {
  installLocation("https://reader.example/chapter/1");
  const dom = new JSDOM(`<img id="page" />`);
  const sent: unknown[] = [];
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message: unknown) => {
        sent.push(message);
        return { ok: true, imageData: "data:image/webp;base64,YWJj", contentType: "image/webp" };
      },
    },
  } as unknown as typeof chrome;
  const surface: DetectedSurface = {
    surfaceId: "img:1:https://cdn.example/page.webp",
    kind: "image",
    element: dom.window.document.querySelector<HTMLElement>("#page")!,
    imageUrl: "https://cdn.example/page.webp",
    rect: { x: 1, y: 2, width: 800, height: 1200 },
    naturalSize: { width: 1000, height: 1500 },
    score: 10,
  };

  const task = await createSurfaceTaskWithImageData(surface, "p0", "zh-CN");

  assert.equal(task.imageData, "data:image/webp;base64,YWJj");
  assert.equal("imageUrl" in task, false);
  assert.deepEqual(sent, [{ source: "umt-content", command: "fetchImageData", url: "https://cdn.example/page.webp", referer: "https://reader.example/chapter/1" }]);
});

test("createSurfaceTaskWithImageDataCapture records fetched evidence at the real entry point", async () => {
  installLocation("https://reader.example/chapter/1");
  installDevicePixelRatio(2);
  const dom = new JSDOM(`<img id="page" />`);
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => ({
        ok: true,
        imageData: "DATA:image/webp;base64,YWJjZA==",
        contentType: "image/webp",
      }),
    },
  } as unknown as typeof chrome;
  const surface: DetectedSurface = {
    surfaceId: "img:fetch:https://cdn.example/page.webp",
    kind: "image",
    element: dom.window.document.querySelector<HTMLElement>("#page")!,
    imageUrl: "https://cdn.example/page.webp",
    rect: { x: 11, y: 22, width: 800, height: 1200 },
    naturalSize: { width: 1000, height: 1500 },
    score: 10,
  };

  const result = await createSurfaceTaskWithImageDataCapture(surface, "p1", "ja");

  assert.equal(result.task.imageData, "DATA:image/webp;base64,YWJjZA==");
  assert.equal("imageUrl" in result.task, false);
  assert.equal(result.capture.captureSource, "image-fetch");
  assert.equal(result.capture.mimeType, "image/webp");
  assert.equal(result.capture.byteLength, 4);
  assert.deepEqual(result.capture.unit.naturalSize, { width: 1000, height: 1500 });
  assert.deepEqual(result.capture.unit.crop, { x: 0, y: 0, width: 1000, height: 1500 });
  assert.deepEqual(result.capture.unit.pixelSize, { width: 1000, height: 1500 });
  assert.equal(result.capture.unit.scaleX, 1);
  assert.equal(result.capture.unit.scaleY, 1);
  assert.equal(result.capture.unit.priority, "p1");
  assert.equal(result.capture.devicePixelRatio, 2);
});

test("createSurfaceTaskWithImageData falls back to imageUrl when extension fetch fails", async () => {
  installLocation("https://reader.example/chapter/1");
  const dom = new JSDOM(`<img id="page" />`);
  globalThis.chrome = { runtime: { sendMessage: async () => ({ ok: false, error: "429" }) } } as unknown as typeof chrome;
  const surface: DetectedSurface = {
    surfaceId: "img:1:https://cdn.example/page.webp",
    kind: "image",
    element: dom.window.document.querySelector<HTMLElement>("#page")!,
    imageUrl: "https://cdn.example/page.webp",
    rect: { x: 1, y: 2, width: 800, height: 1200 },
    naturalSize: { width: 1000, height: 1500 },
    score: 10,
  };

  const task = await createSurfaceTaskWithImageData(surface, "p0", "zh-CN");

  assert.equal(task.imageUrl, "https://cdn.example/page.webp");
  assert.equal("imageData" in task, false);
});

test("createSurfaceTaskWithImageDataCapture preserves URL fallback evidence", async () => {
  installLocation("https://reader.example/chapter/1");
  const dom = new JSDOM(`<img id="page" />`);
  globalThis.chrome = { runtime: { sendMessage: async () => ({ ok: false, error: "429" }) } } as unknown as typeof chrome;
  const surface: DetectedSurface = {
    surfaceId: "img:fallback:https://cdn.example/page.webp",
    kind: "image",
    element: dom.window.document.querySelector<HTMLElement>("#page")!,
    imageUrl: "https://cdn.example/page.webp",
    rect: { x: 1, y: 2, width: 800, height: 1200 },
    naturalSize: { width: 1000, height: 1500 },
    score: 10,
  };

  const result = await createSurfaceTaskWithImageDataCapture(surface, "p0");

  assert.equal(result.task.imageUrl, surface.imageUrl);
  assert.equal(result.capture.captureSource, "image-url");
  assert.equal(result.capture.imageData, undefined);
  assert.equal(result.capture.mimeType, "application/octet-stream");
  assert.equal(result.capture.byteLength, 0);
});


test("createSurfaceTaskWithImageData can reject URL fallback so backend does not hit manga CDN", async () => {
  installLocation("https://reader.example/chapter/1");
  const dom = new JSDOM(`<img id="page" />`);
  globalThis.chrome = { runtime: { sendMessage: async () => ({ ok: false, error: "429" }) } } as unknown as typeof chrome;
  const surface: DetectedSurface = {
    surfaceId: "img:1:https://cdn.example/page.webp",
    kind: "image",
    element: dom.window.document.querySelector<HTMLElement>("#page")!,
    imageUrl: "https://cdn.example/page.webp",
    rect: { x: 1, y: 2, width: 800, height: 1200 },
    naturalSize: { width: 1000, height: 1500 },
    score: 10,
  };

  await assert.rejects(
    () => createSurfaceTaskWithImageData(surface, "p0", "zh-CN", { allowImageUrlFallback: false }),
    /image data fetch unavailable|429/,
  );
});
