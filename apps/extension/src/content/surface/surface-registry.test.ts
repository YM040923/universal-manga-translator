import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { isLikelyReaderPage, SurfaceRegistry } from "./surface-registry.js";

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

function setupEmbedFrameDom(): { doc: Document; surfaces: ReturnType<typeof SurfaceRegistry.scan>["surfaces"] } {
  const dom = new JSDOM(`<!doctype html><html><body>
    <img id="p1" src="https://cdn.example.test/a8f921.webp">
  </body></html>`, { url: "https://embed.example.test/" });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLImageElement = dom.window.HTMLImageElement;
  const image = dom.window.document.querySelector<HTMLImageElement>("#p1")!;
  Object.defineProperty(image, "naturalWidth", { value: 800, configurable: true });
  Object.defineProperty(image, "naturalHeight", { value: 12000, configurable: true });
  image.getBoundingClientRect = () => ({ x: 20, y: 0, left: 20, top: 0, right: 820, bottom: 12000, width: 800, height: 12000, toJSON: () => ({}) });
  return { doc: dom.window.document, surfaces: SurfaceRegistry.scan(dom.window.document).surfaces };
}

function boxDom(html: string, url: string, boxes: Record<string, { x?: number; y?: number; width: number; height: number }>): Document {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLImageElement = dom.window.HTMLImageElement;
  globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;
  for (const [id, box] of Object.entries(boxes)) {
    const element = dom.window.document.getElementById(id)!;
    const rect = { x: box.x ?? 0, y: box.y ?? 0, width: box.width, height: box.height };
    element.getBoundingClientRect = () => ({ ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => ({}) });
    if ("naturalWidth" in element) {
      Object.defineProperty(element, "naturalWidth", { value: rect.width, configurable: true });
      Object.defineProperty(element, "naturalHeight", { value: rect.height, configurable: true });
    }
  }
  return dom.window.document;
}

test("SurfaceRegistry keeps a large page image and ignores a small icon", () => {
  const doc = boxDom(
    `<img id="icon" src="/icon.png"><img id="page" src="/chapter/page-001.jpg">`,
    "https://example.test/reader",
    { icon: { width: 32, height: 32 }, page: { width: 800, height: 1200 } },
  );

  const surfaces = SurfaceRegistry.scan(doc).surfaces;

  assert.deepEqual(surfaces.map((surface) => surface.element.id), ["page"]);
  assert.equal(surfaces[0]?.kind, "image");
});

test("SurfaceRegistry detects a page painted as a CSS background image", () => {
  const doc = boxDom(
    `<div id="bg" style="background-image:url('/chapter/bg-page-001.jpg')"></div>`,
    "https://example.test/reader",
    { bg: { x: 20, y: 40, width: 760, height: 1180 } },
  );

  const surfaces = SurfaceRegistry.scan(doc).surfaces;

  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]?.kind, "background");
  assert.equal(surfaces[0]?.imageUrl, "https://example.test/chapter/bg-page-001.jpg");
});

test("SurfaceRegistry exports a canvas painter into pixel data", () => {
  const doc = boxDom(`<canvas id="c"></canvas>`, "https://example.test/reader", { c: { width: 900, height: 1300 } });
  Object.defineProperty(doc.querySelector("#c")!, "toDataURL", { value: () => "data:image/png;base64,abc123" });
  Object.defineProperty(doc.querySelector("#c")!, "width", { value: 900, configurable: true });
  Object.defineProperty(doc.querySelector("#c")!, "height", { value: 1300, configurable: true });

  const surfaces = SurfaceRegistry.scan(doc).surfaces;

  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]?.kind, "canvas");
  assert.equal(surfaces[0]?.imageData, "data:image/png;base64,abc123");
  assert.equal(surfaces[0]?.cacheKey, surfaces[0]?.surfaceId);
});

test("SurfaceRegistry ignores a canvas whose context is tainted", () => {
  const doc = boxDom(`<canvas id="c"></canvas>`, "https://example.test/reader", { c: { width: 900, height: 1300 } });
  Object.defineProperty(doc.querySelector("#c")!, "toDataURL", { value: () => { throw new Error("tainted"); } });

  assert.deepEqual(SurfaceRegistry.scan(doc).surfaces, []);
});

test("SurfaceRegistry finds pages painted inside an open shadow root", () => {
  const doc = boxDom(`<div id="reader"></div>`, "https://example.test/reader", {});
  const host = doc.querySelector<HTMLElement>("#reader")!;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<img id="shadow-page" src="/chapter/page-007.jpg">`;
  const page = shadow.querySelector<HTMLImageElement>("#shadow-page")!;
  page.getBoundingClientRect = () => ({ x: 0, y: 100, left: 0, top: 100, right: 800, bottom: 1300, width: 800, height: 1200, toJSON: () => ({}) });
  Object.defineProperty(page, "naturalWidth", { value: 800, configurable: true });
  Object.defineProperty(page, "naturalHeight", { value: 1200, configurable: true });

  const surfaces = SurfaceRegistry.scan(doc).surfaces;

  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]?.element.id, "shadow-page");
  assert.equal(surfaces[0]?.imageUrl, "https://example.test/chapter/page-007.jpg");
});

test("SurfaceRegistry keeps the img when a wrapper repeats its url as a background", () => {
  const doc = boxDom(
    `<div id="wrap" style="background-image:url('/chapter/page-003.jpg')"><img id="page" src="/chapter/page-003.jpg"></div>`,
    "https://example.test/reader",
    { wrap: { width: 800, height: 1200 }, page: { width: 800, height: 1200 } },
  );

  const surfaces = SurfaceRegistry.scan(doc).surfaces;

  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]?.kind, "image");
  assert.equal(surfaces[0]?.element.id, "page");
});

test("SurfaceRegistry accepts a wide landscape spread and reads it as a chapter page", () => {
  const doc = boxDom(`<img id="spread" src="/chapter/page-004.jpg">`, "https://example.test/reader", { spread: { width: 2400, height: 1400 } });

  const surfaces = SurfaceRegistry.scan(doc).surfaces;

  assert.equal(surfaces.length, 1);
  assert.equal(isLikelyReaderPage(doc, surfaces), true);
});

test("isLikelyReaderPage treats a canvas that paints the viewport as the page itself", () => {
  const doc = boxDom(`<canvas id="reader"></canvas>`, "https://example.test/watch/12345", { reader: { width: 900, height: 1200 } });
  const canvas = doc.getElementById("reader")! as unknown as HTMLCanvasElement;
  canvas.width = 900;
  canvas.height = 1200;
  canvas.toDataURL = () => "data:image/png;base64,AAAA";

  const surfaces = SurfaceRegistry.scan(doc).surfaces;

  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]!.kind, "canvas");
  assert.equal(isLikelyReaderPage(doc, surfaces), true);
});

test("isLikelyReaderPage keeps an unrelated tall image dormant without url evidence", () => {
  const doc = boxDom(`<img id="banner" src="/assets/hero-art.jpg">`, "https://example.test/series/the-title", { banner: { width: 800, height: 12000 } });

  const surfaces = SurfaceRegistry.scan(doc).surfaces;

  assert.equal(surfaces.length, 1);
  assert.equal(isLikelyReaderPage(doc, surfaces, { pageUrl: "https://example.test/series/the-title", isTopFrame: true }), false);
});

test("isLikelyReaderPage lets a reader frame inherit the chapter page that embeds it", () => {
  const { doc, surfaces } = setupEmbedFrameDom();

  assert.equal(surfaces.length, 1);
  assert.equal(isLikelyReaderPage(doc, surfaces, { pageUrl: "https://manga.example/the-title/chapter/9", isTopFrame: false }), true);
});

test("isLikelyReaderPage keeps an empty reader frame dormant until its pages arrive", () => {
  const doc = new JSDOM(`<!doctype html><html><body></body></html>`, { url: "https://embedded-reader.test/" }).window.document;

  assert.equal(isLikelyReaderPage(doc, [], { pageUrl: "https://manga.example/the-title/chapter/9", isTopFrame: false }), false);
});

test("isLikelyReaderPage does not inherit a chapter signal for the top frame", () => {
  const { doc, surfaces } = setupEmbedFrameDom();

  assert.equal(isLikelyReaderPage(doc, surfaces, { pageUrl: "https://manga.example/the-title/chapter/9", isTopFrame: true }), false);
});

test("isLikelyReaderPage does not inherit a listing page into a reader frame", () => {
  const { doc, surfaces } = setupEmbedFrameDom();

  assert.equal(isLikelyReaderPage(doc, surfaces, { pageUrl: "https://manga.example/comics/the-title", isTopFrame: false }), false);
});
