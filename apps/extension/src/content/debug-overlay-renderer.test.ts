import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { DebugOverlayRenderer } from "./debug-overlay-renderer.js";

test("DebugOverlayRenderer renders detected surface boxes and status labels", () => {
  const dom = new JSDOM("<body><img id='manga' /></body>", { pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  const element = document.querySelector<HTMLElement>("#manga")!;
  element.getBoundingClientRect = () => ({ x: 10, y: 20, width: 300, height: 400, top: 20, left: 10, right: 310, bottom: 420, toJSON: () => ({}) } as DOMRect);

  const renderer = new DebugOverlayRenderer();
  renderer.setEnabled(true);
  renderer.markSurface("s1", element, "detected", "p0 image");

  const node = document.querySelector<HTMLElement>("[data-umt-debug-surface-id='s1']")!;
  assert.ok(node);
  assert.match(node.textContent ?? "", /detected/);
  assert.match(node.getAttribute("style") ?? "", /left:\s*10px/);
});

test("DebugOverlayRenderer renders returned AI region boxes", () => {
  const dom = new JSDOM("<body><img id='manga' /></body>", { pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  const element = document.querySelector<HTMLElement>("#manga")!;
  element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 500, height: 1000, top: 0, left: 0, right: 500, bottom: 1000, toJSON: () => ({}) } as DOMRect);

  const renderer = new DebugOverlayRenderer();
  renderer.setEnabled(true);
  renderer.markResult(element, { width: 1000, height: 2000 }, {
    surfaceId: "s1",
    imageHash: "hash",
    status: "completed",
    providerProfile: "test",
    layoutVersion: 1,
    elapsedMs: 1,
    regions: [{
      id: "r1",
      box: { x: 100, y: 200, width: 300, height: 400 },
      sourceText: "hi",
      translatedText: "你好",
      confidence: 1,
      orientation: "horizontal",
      kind: "dialogue",
      style: { fontSize: 14, writingMode: "horizontal-tb", align: "center", background: "white", color: "black" },
    }],
  });

  const region = document.querySelector<HTMLElement>("[data-umt-debug-region-id='r1']")!;
  assert.ok(region);
  assert.match(region.getAttribute("style") ?? "", /left:\s*50px/);
  assert.match(region.getAttribute("style") ?? "", /width:\s*150px/);
});


test("DebugOverlayRenderer skips unusable region boxes", () => {
  const dom = new JSDOM("<body><img id='manga' /></body>", { pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  const element = document.querySelector<HTMLElement>("#manga")!;
  element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, toJSON: () => ({}) } as DOMRect);
  const renderer = new DebugOverlayRenderer();
  renderer.setEnabled(true);

  renderer.markResult(element, { width: 100, height: 100 }, {
    surfaceId: "debug-clamped",
    imageHash: "hash",
    status: "completed",
    providerProfile: "test",
    layoutVersion: 1,
    elapsedMs: 1,
    regions: [{
      id: "bad",
      box: { x: 200, y: 200, width: 5, height: 5 },
      sourceText: "bad",
      translatedText: "坏",
      confidence: 1,
      orientation: "horizontal",
      kind: "dialogue",
      style: { fontSize: 14, writingMode: "horizontal-tb", align: "center", background: "white", color: "black" },
    }],
  });

  assert.equal(document.querySelector("[data-umt-debug-region-id='bad']"), null);
});
