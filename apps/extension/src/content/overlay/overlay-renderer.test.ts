import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { SurfaceResult } from "@umt/shared/types";
import { loadManualEdit, OverlayRenderer, saveManualEdit } from "./overlay-renderer.js";

test("renders translated regions over a surface", () => {
  const dom = new JSDOM(`<body><img id="page" /></body>`, { url: "https://example.test" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.CSS = dom.window.CSS;
  const img = document.querySelector<HTMLImageElement>("#page")!;
  Object.defineProperty(img, "getBoundingClientRect", { value: () => ({ x: 10, y: 20, width: 500, height: 1000 }) });
  const renderer = new OverlayRenderer();
  const result: SurfaceResult = {
    surfaceId: "s1",
    imageHash: "hash",
    status: "completed",
    providerProfile: "mock",
    layoutVersion: 1,
    elapsedMs: 1,
    regions: [{
      id: "r1",
      box: { x: 100, y: 100, width: 200, height: 100 },
      sourceText: "Hello",
      translatedText: "你好",
      confidence: 1,
      orientation: "horizontal",
      kind: "dialogue",
      style: { fontSize: 20, writingMode: "horizontal-tb", align: "center", background: "white", color: "black" },
    }],
  };
  renderer.render(img, { width: 1000, height: 2000 }, result);
  assert.equal(document.querySelector("[data-umt-region-id='r1']")?.textContent, "你好");
});

test("stores manual edits by image hash and region id", () => {
  saveManualEdit("hash", "zh-CN", "r1", "改好的译文");
  assert.equal(loadManualEdit("hash", "zh-CN", "r1"), "改好的译文");
});
