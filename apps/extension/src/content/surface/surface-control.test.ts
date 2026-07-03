import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { SurfaceControl } from "./surface-control.js";

function setupDom(): HTMLImageElement {
  const dom = new JSDOM("<!doctype html><html><body><img id='page'></body></html>", { url: "https://reader.example/chapter/1" });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLImageElement = dom.window.HTMLImageElement;
  const img = dom.window.document.querySelector<HTMLImageElement>("#page")!;
  img.getBoundingClientRect = () => ({ x: 100, y: 200, left: 100, top: 200, right: 900, bottom: 1400, width: 800, height: 1200, toJSON: () => ({}) });
  Object.defineProperty(dom.window, "scrollX", { value: 10, configurable: true });
  Object.defineProperty(dom.window, "scrollY", { value: 20, configurable: true });
  return img;
}

test("SurfaceControl mounts a faint button at the image top-left", () => {
  const img = setupDom();
  let clicked = "";
  const control = new SurfaceControl({ surfaceId: "s1", image: img, index: 1, onAction: (surfaceId) => { clicked = surfaceId; } });

  control.mount();
  control.setStatus("idle");

  const button = document.querySelector<HTMLButtonElement>("[data-umt-surface-button='s1']")!;
  assert.equal(button.textContent?.includes("翻译"), true);
  assert.equal(button.style.left, "118px");
  assert.equal(button.style.top, "228px");
  assert.equal(button.style.opacity, "0.18");
  assert.equal(button.style.background, "rgb(100, 116, 139)");

  img.dispatchEvent(new window.Event("mouseenter"));
  assert.equal(button.style.opacity, "0.78");
  img.dispatchEvent(new window.Event("mouseleave"));
  assert.equal(button.style.opacity, "0.18");

  button.click();
  assert.equal(clicked, "s1");
});

test("SurfaceControl updates label, queue number, color, and retry title", () => {
  const img = setupDom();
  const control = new SurfaceControl({ surfaceId: "s2", image: img, index: 2, onAction: () => undefined });
  control.mount();

  control.setStatus("queued", { queueIndex: 3 });
  const button = document.querySelector<HTMLButtonElement>("[data-umt-surface-button='s2']")!;
  assert.equal(button.textContent?.includes("排队 #3"), true);
  assert.equal(button.style.background, "rgb(37, 99, 235)");

  control.setStatus("failed", { detail: "OCR timeout" });
  assert.equal(button.textContent?.includes("重试"), true);
  assert.equal(button.title.includes("OCR timeout"), true);
  assert.equal(button.style.background, "rgb(220, 38, 38)");
});

test("SurfaceControl refresh keeps button attached to image document coordinates", () => {
  const img = setupDom();
  let top = 300;
  img.getBoundingClientRect = () => ({ x: 40, y: top, left: 40, top, right: 840, bottom: top + 1000, width: 800, height: 1000, toJSON: () => ({}) });
  const control = new SurfaceControl({ surfaceId: "s3", image: img, index: 3, onAction: () => undefined });
  control.mount();

  top = 500;
  control.refreshPosition();

  const button = document.querySelector<HTMLButtonElement>("[data-umt-surface-button='s3']")!;
  assert.equal(button.style.left, "58px");
  assert.equal(button.style.top, "528px");
});

test("SurfaceControl can update the displayed image index after rescans", () => {
  const img = setupDom();
  const control = new SurfaceControl({ surfaceId: "s4", image: img, index: 4, onAction: () => undefined });
  control.mount();
  control.setStatus("idle");

  control.updateIndex(2);
  control.setStatus("completed");

  const button = document.querySelector<HTMLButtonElement>("[data-umt-surface-button='s4']")!;
  assert.equal(button.textContent?.startsWith("#2 "), true);
  assert.equal(button.dataset.umtSurfaceIndex, "2");
  assert.equal(button.title.includes("第 2 张"), true);
});
