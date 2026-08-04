import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createDocumentRectOverlayAnchor, createRectOverlayAnchor, documentRectFromViewportRect } from "./rect-anchor.js";

test("createRectOverlayAnchor exposes a stable viewport rect for screenshot overlays", () => {
  const dom = new JSDOM("<body></body>");
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  Object.defineProperty(window, "scrollX", { value: 0, configurable: true });
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
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

test("createRectOverlayAnchor stays attached to document content when the page scrolls", () => {
  const dom = new JSDOM("<body></body>");
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  Object.defineProperty(window, "scrollX", { value: 0, configurable: true });
  Object.defineProperty(window, "scrollY", { value: 100, configurable: true });

  const anchor = createRectOverlayAnchor({ x: 20, y: 50, width: 120, height: 80 });
  assert.equal(anchor.getBoundingClientRect().top, 50);

  Object.defineProperty(window, "scrollY", { value: 160, configurable: true });
  const afterScroll = anchor.getBoundingClientRect();

  assert.equal(afterScroll.top, -10);
  assert.equal(afterScroll.bottom, 70);
});

test("createDocumentRectOverlayAnchor restores cached manual selection document coordinates", () => {
  const dom = new JSDOM("<body></body>");
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  Object.defineProperty(window, "scrollX", { value: 0, configurable: true });
  Object.defineProperty(window, "scrollY", { value: 120, configurable: true });

  const anchor = createDocumentRectOverlayAnchor({ x: 20, y: 300, width: 120, height: 80 });
  const rect = anchor.getBoundingClientRect();

  assert.equal(rect.top, 180);
  assert.equal(rect.bottom, 260);
});

test("documentRectFromViewportRect keeps the selection attached to where it was made after OCR finishes", () => {
  const dom = new JSDOM("<body></body>");
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  Object.defineProperty(window, "scrollX", { value: 16, configurable: true });
  Object.defineProperty(window, "scrollY", { value: 400, configurable: true });

  const documentRect = documentRectFromViewportRect({ x: 24, y: 80, width: 120, height: 60 });

  Object.defineProperty(window, "scrollX", { value: 42, configurable: true });
  Object.defineProperty(window, "scrollY", { value: 900, configurable: true });
  const anchor = createDocumentRectOverlayAnchor(documentRect);

  assert.deepEqual(documentRect, { x: 40, y: 480, width: 120, height: 60 });
  assert.equal(anchor.getBoundingClientRect().top, -420);
  assert.equal(anchor.getBoundingClientRect().left, -2);
});
