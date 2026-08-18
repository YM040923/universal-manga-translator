import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { DetectedSurface } from "../detector/surface-detector.js";
import type { ScreenshotCropRect } from "./screenshot-crop.js";
import { createSurfaceTask, createSurfaceTaskWithImageData } from "./surface-capture.js";

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

test("createSurfaceTaskWithImageData prefers extension-fetched image data over backend URL fetch", async () => {
  installLocation("https://reader.example/chapter/1");
  const dom = new JSDOM(`<img id="page" />`);
  const sent: unknown[] = [];
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message: unknown) => {
        sent.push(message);
        return { ok: true, imageData: "data:image/webp;base64,abc", contentType: "image/webp" };
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

  assert.equal(task.imageData, "data:image/webp;base64,abc");
  assert.equal("imageUrl" in task, false);
  assert.deepEqual(sent, [{ source: "umt-content", command: "fetchImageData", url: "https://cdn.example/page.webp", referer: "https://reader.example/chapter/1" }]);
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

test("createSurfaceTaskWithImageData falls back to a screenshot crop when image fetch fails in direct mode", async () => {
  installLocation("https://reader.example/chapter/1");
  const dom = new JSDOM(`<img id="page" />`);
  globalThis.chrome = { runtime: { sendMessage: async () => ({ ok: false, error: "403" }) } } as unknown as typeof chrome;
  const img = dom.window.document.querySelector<HTMLElement>("#page")!;
  img.getBoundingClientRect = () => ({
    x: 20, y: 30, width: 800, height: 900, top: 30, left: 20, right: 820, bottom: 930, toJSON: () => ({}),
  }) as DOMRect;
  Object.defineProperty(globalThis, "window", {
    value: { innerWidth: 1920, innerHeight: 1080 },
    configurable: true,
  });
  const surface: DetectedSurface = {
    surfaceId: "img:1:https://cdn.example/page.webp",
    kind: "image",
    element: img,
    imageUrl: "https://cdn.example/page.webp",
    rect: { x: 1, y: 2, width: 800, height: 1200 },
    naturalSize: { width: 1000, height: 1500 },
    score: 10,
  };
  const crops: ScreenshotCropRect[] = [];

  const task = await createSurfaceTaskWithImageData(surface, "p0", "zh-CN", {
    allowImageUrlFallback: false,
    allowScreenshotFallback: true,
    __testScreenshot: async () => "data:image/png;base64,full",
    __testReadScreenshotSize: async () => ({ width: 3840, height: 2160 }),
    __testCropScreenshot: async (_image: string, crop: ScreenshotCropRect) => {
      crops.push(crop);
      return "data:image/png;base64,cropped";
    },
  });

  assert.equal(task.imageData, "data:image/png;base64,cropped");
  assert.deepEqual(task.naturalSize, { width: 1600, height: 1800 });
  assert.deepEqual(crops[0], { x: 40, y: 60, width: 1600, height: 1800 });
});

test("createSurfaceTaskWithImageData does not use a screenshot fallback for offscreen images", async () => {
  installLocation("https://reader.example/chapter/1");
  const dom = new JSDOM(`<img id="page" />`);
  globalThis.chrome = { runtime: { sendMessage: async () => ({ ok: false, error: "403" }) } } as unknown as typeof chrome;
  const img = dom.window.document.querySelector<HTMLElement>("#page")!;
  img.getBoundingClientRect = () => ({
    x: 0, y: 5000, width: 800, height: 1200, top: 5000, left: 0, right: 800, bottom: 6200, toJSON: () => ({}),
  }) as DOMRect;
  Object.defineProperty(globalThis, "window", {
    value: { innerWidth: 1920, innerHeight: 1080 },
    configurable: true,
  });
  const surface: DetectedSurface = {
    surfaceId: "img:1:https://cdn.example/page.webp",
    kind: "image",
    element: img,
    imageUrl: "https://cdn.example/page.webp",
    rect: { x: 1, y: 2, width: 800, height: 1200 },
    naturalSize: { width: 1000, height: 1500 },
    score: 10,
  };

  await assert.rejects(
    () => createSurfaceTaskWithImageData(surface, "p0", "zh-CN", { allowImageUrlFallback: false, allowScreenshotFallback: true }),
    /image data fetch unavailable|403/,
  );
});
