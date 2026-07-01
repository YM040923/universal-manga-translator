import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRectOverlayAnchor } from "./rect-anchor.js";

test("createRectOverlayAnchor exposes a stable viewport rect for screenshot overlays", () => {
  const dom = new JSDOM("<body></body>");
  globalThis.document = dom.window.document;
  const anchor = createRectOverlayAnchor({ x: 12, y: 34, width: 200, height: 300 });
  const rect = anchor.getBoundingClientRect();

  assert.equal(rect.x, 12);
  assert.equal(rect.y, 34);
  assert.equal(rect.left, 12);
  assert.equal(rect.top, 34);
  assert.equal(rect.right, 212);
  assert.equal(rect.bottom, 334);
  assert.equal(rect.width, 200);
  assert.equal(rect.height, 300);
});
