import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { DetectedSurface } from "../detector/surface-detector.js";
import { createSurfaceTask } from "./surface-capture.js";

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