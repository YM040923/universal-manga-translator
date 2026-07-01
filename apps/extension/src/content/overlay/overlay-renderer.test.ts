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


test("render restores overlay visibility after the page was cleared", () => {
  const { img } = setupDomWithImage({ x: 10, y: 20, width: 500, height: 1000 });
  const renderer = new OverlayRenderer();

  renderer.setVisible(false);
  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("s1"));

  const root = document.querySelector<HTMLElement>("[data-umt-overlay-root='true']")!;
  assert.equal(root.style.display, "block");
  assert.equal(document.querySelector("[data-umt-region-id='r1']")?.textContent, "hello translated");
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

  document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!.click();

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
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 100, height: 100 });
  const renderer = new OverlayRenderer();
  renderer.render(img, { width: 100, height: 100 }, {
    surfaceId: "vertical-surface",
    imageHash: "vertical-hash",
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

  assert.equal((document.querySelector("[data-umt-text-chip='true']") as HTMLElement).style.writingMode, "vertical-rl");
});


test("clamps overlay boxes to the rendered surface and skips unusable boxes", () => {
  const { img } = setupDomWithImage({ x: 10, y: 20, width: 100, height: 100 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("clamped");
  result.regions = [
    { ...result.regions[0]!, id: "keep", box: { x: -10, y: 10, width: 40, height: 30 } },
    { ...result.regions[0]!, id: "skip", box: { x: 200, y: 200, width: 5, height: 5 } },
  ];

  renderer.render(img, { width: 100, height: 100 }, result);

  const keep = document.querySelector<HTMLElement>("[data-umt-region-id='keep']")!;
  assert.equal(keep.style.left, "10px");
  assert.equal(keep.style.top, "30px");
  assert.equal(keep.style.width, "30px");
  assert.equal(document.querySelector("[data-umt-region-id='skip']"), null);
});


test("renders adaptive text chip inside large provider box instead of a full white slab", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 500, height: 500 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("adaptive-chip");
  result.imageHash = "adaptive-hash";
  result.regions = [{ ...result.regions[0]!, translatedText: "?", box: { x: 0, y: 0, width: 500, height: 300 } }];

  renderer.render(img, { width: 500, height: 500 }, result);

  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  const chip = wrapper.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  assert.equal(wrapper.style.background, "transparent");
  assert.equal(wrapper.style.minHeight, "");
  assert.equal(chip.textContent, "?");
  assert.equal(chip.style.width, "fit-content");
  assert.equal(chip.style.maxWidth, "100%");
});
