import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { SurfaceRegistry } from "./surface-registry.js";

function setupDom(): Document {
  const dom = new JSDOM(`<!doctype html><html><body>
    <img id="ad" src="/ad.png">
    <img id="p3" src="https://cdn.example/chapter/003.webp">
    <img id="p1" src="https://cdn.example/chapter/001.webp">
    <img id="p2" src="https://cdn.example/chapter/002.webp">
  </body></html>`, { url: "https://reader.example/title/chapter/60" });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLImageElement = dom.window.HTMLImageElement;
  const rects: Record<string, { y: number; width: number; height: number }> = {
    ad: { y: 50, width: 120, height: 90 },
    p1: { y: 100, width: 800, height: 1200 },
    p2: { y: 1400, width: 800, height: 1300 },
    p3: { y: 2900, width: 800, height: 1100 },
  };
  for (const img of [...dom.window.document.images]) {
    const id = img.id;
    const r = rects[id]!;
    Object.defineProperty(img, "naturalWidth", { value: r.width, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: r.height, configurable: true });
    img.getBoundingClientRect = () => ({ x: 20, y: r.y, left: 20, top: r.y, right: 20 + r.width, bottom: r.y + r.height, width: r.width, height: r.height, toJSON: () => ({}) });
  }
  return dom.window.document;
}

test("SurfaceRegistry scans manga images and sorts by reading order instead of DOM order", () => {
  const doc = setupDom();
  const registry = SurfaceRegistry.scan(doc);

  assert.deepEqual(registry.surfaces.map((surface) => surface.index), [1, 2, 3]);
  assert.deepEqual(registry.surfaces.map((surface) => surface.element.id), ["p1", "p2", "p3"]);
  assert.equal(registry.surfaces.every((surface) => surface.surfaceId.includes("https://cdn.example/chapter/")), true);
});

test("SurfaceRegistry keeps stable ids across rescans of the same image urls", () => {
  const doc = setupDom();
  const first = SurfaceRegistry.scan(doc).surfaces.map((surface) => surface.surfaceId);
  const second = SurfaceRegistry.scan(doc).surfaces.map((surface) => surface.surfaceId);

  assert.deepEqual(second, first);
});


test("SurfaceRegistry sorts by document position even after the page is scrolled", () => {
  const doc = setupDom();
  Object.defineProperty(window, "scrollY", { value: 2000, configurable: true });
  const p1 = doc.querySelector<HTMLImageElement>("#p1")!;
  const p2 = doc.querySelector<HTMLImageElement>("#p2")!;
  p1.getBoundingClientRect = () => ({ x: 20, y: -1900, left: 20, top: -1900, right: 820, bottom: -700, width: 800, height: 1200, toJSON: () => ({}) });
  p2.getBoundingClientRect = () => ({ x: 20, y: -600, left: 20, top: -600, right: 820, bottom: 700, width: 800, height: 1300, toJSON: () => ({}) });

  const registry = SurfaceRegistry.scan(doc);

  assert.deepEqual(registry.surfaces.map((surface) => surface.element.id).slice(0, 2), ["p1", "p2"]);
  assert.equal(registry.surfaces[0]?.rect.y, 100);
  assert.equal(registry.surfaces[1]?.rect.y, 1400);
});

test("SurfaceRegistry ignores tiny rendered avatar images even when original file is large", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <img id="page" src="https://cdn.example/chapter/001.webp">
    <img id="avatar" src="https://cdn.example/profiles/large-avatar.webp">
  </body></html>`, { url: "https://reader.example/title/chapter/60" });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLImageElement = dom.window.HTMLImageElement;
  const page = dom.window.document.querySelector<HTMLImageElement>("#page")!;
  const avatar = dom.window.document.querySelector<HTMLImageElement>("#avatar")!;
  Object.defineProperty(page, "naturalWidth", { value: 800, configurable: true });
  Object.defineProperty(page, "naturalHeight", { value: 12000, configurable: true });
  page.getBoundingClientRect = () => ({ x: 20, y: 100, left: 20, top: 100, right: 820, bottom: 12100, width: 800, height: 12000, toJSON: () => ({}) });
  Object.defineProperty(avatar, "naturalWidth", { value: 1200, configurable: true });
  Object.defineProperty(avatar, "naturalHeight", { value: 1800, configurable: true });
  avatar.getBoundingClientRect = () => ({ x: 40, y: 13000, left: 40, top: 13000, right: 80, bottom: 13040, width: 40, height: 40, toJSON: () => ({}) });

  const registry = SurfaceRegistry.scan(dom.window.document);

  assert.deepEqual(registry.surfaces.map((surface) => surface.element.id), ["page"]);
});
