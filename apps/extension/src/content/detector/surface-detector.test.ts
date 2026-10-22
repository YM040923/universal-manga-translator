import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  canvasDataUrl,
  extractBackgroundImageUrl,
  extractImageElementUrl,
  isPlaceholderImageUrl,
} from "./surface-detector.js";

function image(html: string): HTMLImageElement {
  const dom = new JSDOM(`<body>${html}</body>`, { url: "https://example.test" });
  return dom.window.document.querySelector<HTMLImageElement>("img")!;
}

test("reads the real page from a lazy-loading data attribute", () => {
  const img = image(`<img src="/placeholder.gif" data-src="/chapter/page-002.jpg">`);
  assert.equal(extractImageElementUrl(img), "https://example.test/chapter/page-002.jpg");
});

test("prefers the widest srcset candidate when no data attribute is set", () => {
  const img = image(`<img src="/placeholder.gif" srcset="/chapter/small.jpg 400w, /chapter/large.jpg 1200w">`);
  assert.equal(extractImageElementUrl(img), "https://example.test/chapter/large.jpg");
});

test("falls back to src when no lazy source exists", () => {
  const img = image(`<img src="/chapter/page-001.jpg">`);
  assert.equal(extractImageElementUrl(img), "https://example.test/chapter/page-001.jpg");
});

test("resolves a background image url against the page", () => {
  assert.equal(extractBackgroundImageUrl(`url("/chapter/bg-page-001.jpg")`, "https://example.test/reader"), "https://example.test/chapter/bg-page-001.jpg");
  assert.equal(extractBackgroundImageUrl("none", "https://example.test/reader"), "");
});

test("treats a tainted canvas as unreadable instead of throwing", () => {
  const dom = new JSDOM(`<body><canvas id="c" width="900" height="1300"></canvas></body>`, { url: "https://example.test" });
  const canvas = dom.window.document.querySelector<HTMLCanvasElement>("#c")!;
  Object.defineProperty(canvas, "toDataURL", { value: () => { throw new Error("tainted"); } });
  assert.equal(canvasDataUrl(canvas), "");
});

test("recognises placeholder urls so a lazy shell is never submitted", () => {
  assert.equal(isPlaceholderImageUrl("/img/spacer.gif"), true);
  assert.equal(isPlaceholderImageUrl("data:image/gif;base64,R0lGOD"), true);
  assert.equal(isPlaceholderImageUrl("/chapter/page-001.jpg"), false);
});
