import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { isLikelyReaderPage, SurfaceRegistry } from "./surface-registry.js";
import { toDetectedSurface } from "./detected-surface.js";

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

test("isLikelyReaderPage accepts chapter pages with stacked manga pages", () => {
  const doc = setupDom();
  const surfaces = SurfaceRegistry.scan(doc).surfaces;

  assert.equal(isLikelyReaderPage(doc, surfaces), true);
});

test("isLikelyReaderPage rejects comic directory pages with cover images", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <img id="hero" src="https://cdn.example/covers/the-title-400.webp">
    <img id="cover1" src="https://cdn.example/covers/a-400.webp">
    <img id="cover2" src="https://cdn.example/covers/b-400.webp">
  </body></html>`, { url: "https://reader.example/comics/the-title" });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLImageElement = dom.window.HTMLImageElement;
  const rects: Record<string, { x: number; y: number; width: number; height: number }> = {
    hero: { x: 40, y: 80, width: 640, height: 900 },
    cover1: { x: 40, y: 1100, width: 520, height: 720 },
    cover2: { x: 620, y: 1100, width: 520, height: 720 },
  };
  for (const img of [...dom.window.document.images]) {
    const r = rects[img.id]!;
    Object.defineProperty(img, "naturalWidth", { value: r.width, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: r.height, configurable: true });
    img.getBoundingClientRect = () => ({ x: r.x, y: r.y, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height, width: r.width, height: r.height, toJSON: () => ({}) });
  }
  const surfaces = SurfaceRegistry.scan(dom.window.document).surfaces;

  assert.equal(surfaces.length >= 1, true);
  assert.equal(isLikelyReaderPage(dom.window.document, surfaces), false);
});

test("isLikelyReaderPage rejects comic detail pages with stacked large chapter thumbnails", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <img id="cover" src="https://cdn.example/covers/the-title.webp">
    <img id="thumb1" src="https://cdn.example/comics/the-title/chapter-1-thumb.webp">
    <img id="thumb2" src="https://cdn.example/comics/the-title/chapter-2-thumb.webp">
    <img id="thumb3" src="https://cdn.example/comics/the-title/chapter-3-thumb.webp">
  </body></html>`, { url: "https://reader.example/comics/the-title" });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLImageElement = dom.window.HTMLImageElement;
  const rects: Record<string, { x: number; y: number; width: number; height: number }> = {
    cover: { x: 60, y: 80, width: 620, height: 920 },
    thumb1: { x: 80, y: 1160, width: 720, height: 980 },
    thumb2: { x: 80, y: 2240, width: 720, height: 980 },
    thumb3: { x: 80, y: 3320, width: 720, height: 980 },
  };
  for (const img of [...dom.window.document.images]) {
    const r = rects[img.id]!;
    Object.defineProperty(img, "naturalWidth", { value: r.width, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: r.height, configurable: true });
    img.getBoundingClientRect = () => ({ x: r.x, y: r.y, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height, width: r.width, height: r.height, toJSON: () => ({}) });
  }
  const surfaces = SurfaceRegistry.scan(dom.window.document).surfaces;

  assert.equal(surfaces.length >= 3, true);
  assert.equal(isLikelyReaderPage(dom.window.document, surfaces), false);
});

test("isLikelyReaderPage allows reader URLs before lazy images finish loading", () => {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { url: "https://reader.example/comics/the-title/chapter/60" });

  assert.equal(isLikelyReaderPage(dom.window.document, []), true);
});

test("isLikelyReaderPage accepts stacked manga pages even when CDN image urls are opaque hashes", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <img id="p1" src="https://cdn.other-site.test/a8f921.webp">
    <img id="p2" src="https://img.other-site.test/77b311.webp">
    <img id="p3" src="https://assets.other-site.test/raw/00992.webp">
  </body></html>`, { url: "https://manga.example/the-title?episode_id=60" });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLImageElement = dom.window.HTMLImageElement;
  const rects: Record<string, { y: number; width: number; height: number }> = {
    p1: { y: 100, width: 800, height: 1280 },
    p2: { y: 1400, width: 800, height: 1260 },
    p3: { y: 2680, width: 800, height: 1220 },
  };
  for (const img of [...dom.window.document.images]) {
    const r = rects[img.id]!;
    Object.defineProperty(img, "naturalWidth", { value: r.width, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: r.height, configurable: true });
    img.getBoundingClientRect = () => ({ x: 20, y: r.y, left: 20, top: r.y, right: 20 + r.width, bottom: r.y + r.height, width: r.width, height: r.height, toJSON: () => ({}) });
  }
  const surfaces = SurfaceRegistry.scan(dom.window.document).surfaces;

  assert.equal(surfaces.length, 3);
  assert.equal(isLikelyReaderPage(dom.window.document, surfaces), true);
});

test("SurfaceRegistry forwards background and canvas reader pages through the normal capture path", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="background-page" style="background-image:url('/chapter/bg-001.webp')"></div>
    <canvas id="canvas-page" width="800" height="1200"></canvas>
  </body></html>`, { url: "https://reader.example/title/read/60" });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  const background = dom.window.document.querySelector<HTMLElement>("#background-page")!;
  const canvas = dom.window.document.querySelector<HTMLCanvasElement>("#canvas-page")!;
  Object.defineProperty(background, "getBoundingClientRect", { value: () => ({ x: 20, y: 100, left: 20, top: 100, right: 820, bottom: 1300, width: 800, height: 1200, toJSON: () => ({}) }) });
  Object.defineProperty(canvas, "getBoundingClientRect", { value: () => ({ x: 20, y: 1320, left: 20, top: 1320, right: 820, bottom: 2520, width: 800, height: 1200, toJSON: () => ({}) }) });
  Object.defineProperty(canvas, "toDataURL", { value: () => "data:image/png;base64,Y2FudmFz" });

  const registry = SurfaceRegistry.scan(dom.window.document);
  const captured = registry.surfaces.map((surface) => toDetectedSurface(surface));

  assert.deepEqual(captured.map((surface) => surface.kind), ["background", "canvas"]);
  assert.equal(captured[0]?.imageUrl, "https://reader.example/chapter/bg-001.webp");
  assert.equal(captured[1]?.imageData, "data:image/png;base64,Y2FudmFz");
  assert.equal(isLikelyReaderPage(dom.window.document, registry.surfaces), true);
});

test("isLikelyReaderPage accepts query-driven reader routes with opaque image URLs", () => {
  const dom = new JSDOM(`<!doctype html><html><body><img id="page" src="https://cdn.other-site.test/assets/a8f921.webp"></body></html>`, { url: "https://manga.example/title?chapter=60" });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLImageElement = dom.window.HTMLImageElement;
  const page = dom.window.document.querySelector<HTMLImageElement>("#page")!;
  Object.defineProperty(page, "naturalWidth", { value: 800, configurable: true });
  Object.defineProperty(page, "naturalHeight", { value: 1600, configurable: true });
  page.getBoundingClientRect = () => ({ x: 20, y: 100, left: 20, top: 100, right: 820, bottom: 1700, width: 800, height: 1600, toJSON: () => ({}) });

  const surfaces = SurfaceRegistry.scan(dom.window.document).surfaces;

  assert.equal(isLikelyReaderPage(dom.window.document, surfaces), true);
});
