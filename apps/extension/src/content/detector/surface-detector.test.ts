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
  assert.equal(surfaces[0]?.element.id, "page");
});
