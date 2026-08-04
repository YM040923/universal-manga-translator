import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { detectImageSurfaces } from "./surface-detector.js";

test("keeps large manga-like images and ignores small icons", () => {
  const dom = new JSDOM(`<body><img id="icon" src="/icon.png" width="32" height="32" /><img id="page" src="/chapter/page-001.jpg" width="800" height="1200" /></body>`, { url: "https://example.test" });
  const doc = dom.window.document;
  Object.defineProperty(doc.querySelector("#icon"), "getBoundingClientRect", { value: () => ({ x: 0, y: 0, width: 32, height: 32 }) });
  Object.defineProperty(doc.querySelector("#page"), "getBoundingClientRect", { value: () => ({ x: 0, y: 0, width: 800, height: 1200 }) });
  const surfaces = detectImageSurfaces(doc);
  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]?.kind, "image");
  assert.equal(surfaces[0]?.element.id, "page");
});

test("detects large CSS background manga surfaces", () => {
  const dom = new JSDOM(`<body><main><div id="bg" style="background-image:url('/chapter/bg-page-001.jpg')"></div></main></body>`, { url: "https://example.test" });
  const doc = dom.window.document;
  const bg = doc.querySelector<HTMLElement>("#bg")!;
  Object.defineProperty(bg, "getBoundingClientRect", { value: () => ({ x: 20, y: 40, width: 760, height: 1180 }) });
  const surfaces = detectImageSurfaces(doc);
  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]?.kind, "background");
  assert.equal(surfaces[0]?.imageUrl, "https://example.test/chapter/bg-page-001.jpg");
  assert.equal(surfaces[0]?.naturalSize.width, 760);
});

test("detects exportable canvas manga surfaces", () => {
  const dom = new JSDOM(`<body><canvas id="canvas" width="900" height="1300"></canvas></body>`, { url: "https://example.test" });
  const doc = dom.window.document;
  const canvas = doc.querySelector<HTMLCanvasElement>("#canvas")!;
  Object.defineProperty(canvas, "getBoundingClientRect", { value: () => ({ x: 0, y: 100, width: 900, height: 1300 }) });
  Object.defineProperty(canvas, "toDataURL", { value: () => "data:image/png;base64,abc123" });
  const surfaces = detectImageSurfaces(doc);
  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]?.kind, "canvas");
  assert.equal(surfaces[0]?.imageData, "data:image/png;base64,abc123");
});

test("detects lazy-loaded manga image urls from common data attributes", () => {
  const dom = new JSDOM(`<body><img id="lazy" src="/placeholder.gif" data-src="/chapter/page-002.jpg" width="800" height="1200" /></body>`, { url: "https://example.test" });
  const doc = dom.window.document;
  Object.defineProperty(doc.querySelector("#lazy"), "getBoundingClientRect", { value: () => ({ x: 0, y: 0, width: 800, height: 1200 }) });

  const surfaces = detectImageSurfaces(doc);

  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]?.imageUrl, "https://example.test/chapter/page-002.jpg");
});

test("detects manga image urls from srcset when currentSrc is unavailable", () => {
  const dom = new JSDOM(`<body><img id="srcset" src="/placeholder.gif" srcset="/chapter/page-small.jpg 400w, /chapter/page-large.jpg 1200w" width="800" height="1200" /></body>`, { url: "https://example.test" });
  const doc = dom.window.document;
  Object.defineProperty(doc.querySelector("#srcset"), "getBoundingClientRect", { value: () => ({ x: 0, y: 0, width: 800, height: 1200 }) });

  const surfaces = detectImageSurfaces(doc);

  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]?.imageUrl, "https://example.test/chapter/page-large.jpg");
});


test("deduplicates surfaces that point to the same manga image url", () => {
  const dom = new JSDOM(`<body><img id="a" src="/chapter/page-003.jpg" width="800" height="1200" /><img id="b" data-src="/chapter/page-003.jpg" src="/placeholder.gif" width="800" height="1200" /></body>`, { url: "https://example.test" });
  const doc = dom.window.document;
  Object.defineProperty(doc.querySelector("#a"), "getBoundingClientRect", { value: () => ({ x: 0, y: 0, width: 800, height: 1200 }) });
  Object.defineProperty(doc.querySelector("#b"), "getBoundingClientRect", { value: () => ({ x: 0, y: 0, width: 800, height: 1200 }) });

  const surfaces = detectImageSurfaces(doc);

  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]?.imageUrl, "https://example.test/chapter/page-003.jpg");
});

test("detects a manga image inside an open Shadow DOM reader", () => {
  const dom = new JSDOM(`<body><manga-reader id="reader"></manga-reader></body>`, { url: "https://example.test/read/42" });
  const doc = dom.window.document;
  const host = doc.querySelector<HTMLElement>("#reader")!;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<img id="page" src="/chapter/shadow-page.webp" width="800" height="1200">`;
  const page = shadow.querySelector<HTMLImageElement>("#page")!;
  Object.defineProperty(page, "getBoundingClientRect", { value: () => ({ x: 20, y: 100, width: 800, height: 1200 }) });

  const surfaces = detectImageSurfaces(doc);

  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]?.element, page);
  assert.equal(surfaces[0]?.imageUrl, "https://example.test/chapter/shadow-page.webp");
});

test("finds nested open Shadow DOM roots for dynamic reader observation", async () => {
  const detector = await import("./surface-detector.js") as unknown as {
    findOpenShadowRoots?: (root: ParentNode) => ShadowRoot[];
  };
  const dom = new JSDOM(`<body><manga-shell id="outer"></manga-shell></body>`, { url: "https://example.test/read/42" });
  const outer = dom.window.document.querySelector<HTMLElement>("#outer")!;
  const first = outer.attachShadow({ mode: "open" });
  first.innerHTML = `<reader-page id="inner"></reader-page>`;
  const inner = first.querySelector<HTMLElement>("#inner")!;
  const second = inner.attachShadow({ mode: "open" });
  second.innerHTML = `<img src="/chapter/001.webp">`;

  assert.equal(typeof detector.findOpenShadowRoots, "function");
  assert.deepEqual(detector.findOpenShadowRoots!(dom.window.document), [first, second]);
});
