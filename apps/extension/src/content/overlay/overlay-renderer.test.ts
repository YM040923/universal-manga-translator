import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { ManualOverridePayload } from "@umt/shared/protocol";
import type { Rect, SurfaceResult } from "@umt/shared/types";
import { loadManualEdit, OverlayRenderer, saveManualEdit } from "./overlay-renderer.js";

test("renders translated regions over a surface", () => {
  const { img } = setupDomWithImage({ x: 10, y: 20, width: 500, height: 1000 });
  const renderer = new OverlayRenderer();
  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("s1"));
  assert.equal(document.querySelector("[data-umt-region-id='r1']")?.textContent, "hello translated");
});

test("refreshAll repositions overlays after surface layout changes", () => {
  let rect = { x: 10, y: 20, width: 500, height: 1000 };
  const { img } = setupDomWithImage(() => rect);
  const renderer = new OverlayRenderer();
  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("s1"));
  const before = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  assert.equal(before.style.left, "60px");
  assert.equal(before.style.top, "70px");

  rect = { x: 30, y: 60, width: 600, height: 1200 };
  renderer.refreshAll();

  const after = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  assert.equal(after.style.left, "90px");
  assert.equal(after.style.top, "120px");
});

test("stores manual edits by image hash and region id", () => {
  saveManualEdit("hash", "zh-CN", "r1", "edited text");
  assert.equal(loadManualEdit("hash", "zh-CN", "r1"), "edited text");
});

test("manual edit callback receives override payload", () => {
  const { img } = setupDomWithImage({ x: 10, y: 20, width: 500, height: 1000 });
  let saved: ManualOverridePayload | undefined;
  window.prompt = () => "manual edit";
  const renderer = new OverlayRenderer({ targetLanguage: "zh-CN", onManualEdit: (override) => { saved = override; } });
  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("s1"));

  document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!.click();

  assert.deepEqual(saved, { imageHash: "hash", targetLanguage: "zh-CN", regionId: "r1", translatedText: "manual edit" });
});

function setupDomWithImage(rect: Rect | (() => Rect)) {
  const dom = new JSDOM(`<body><img id="page" /></body>`, { url: "https://example.test" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.CSS = dom.window.CSS;
  const img = document.querySelector<HTMLImageElement>("#page")!;
  Object.defineProperty(img, "getBoundingClientRect", { value: () => (typeof rect === "function" ? rect() : rect) });
  return { dom, img };
}

function fakeResult(surfaceId: string): SurfaceResult {
  return {
    surfaceId,
    imageHash: "hash",
    status: "completed",
    providerProfile: "mock",
    layoutVersion: 1,
    elapsedMs: 1,
    regions: [{
      id: "r1",
      box: { x: 100, y: 100, width: 200, height: 100 },
      sourceText: "Hello",
      translatedText: "hello translated",
      confidence: 1,
      orientation: "horizontal",
      kind: "dialogue",
      style: { fontSize: 20, writingMode: "horizontal-tb", align: "center", background: "white", color: "black" },
    }],
  };
}

test("OverlayRenderer applies vertical writing mode from layout style", () => {
  document.body.innerHTML = `<img id="page" />`;
  const img = document.querySelector<HTMLImageElement>("#page")!;
  Object.defineProperty(img, "getBoundingClientRect", { value: () => ({ x: 0, y: 0, width: 100, height: 100 }) });
  const renderer = new OverlayRenderer();
  renderer.render(img, { width: 100, height: 100 }, {
    surfaceId: "vertical-surface",
    imageHash: "hash",
    status: "completed",
    providerProfile: "mock",
    layoutVersion: 2,
    elapsedMs: 1,
    regions: [{
      id: "r1",
      box: { x: 0, y: 0, width: 50, height: 80 },
      sourceText: "縦",
      translatedText: "竖排",
      confidence: 1,
      orientation: "vertical",
      kind: "dialogue",
      style: { fontSize: 16, writingMode: "vertical-rl", align: "center", background: "white", color: "black" },
    }],
  });

  assert.equal((document.querySelector("[data-umt-surface-id='vertical-surface']") as HTMLElement).style.writingMode, "vertical-rl");
});
