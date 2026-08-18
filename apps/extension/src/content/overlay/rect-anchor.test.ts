import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createDocumentRectOverlayAnchor, createElementTrackingOverlayAnchor, createRectOverlayAnchor } from "./rect-anchor.js";

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

function stubElementRect(element: HTMLElement, rect: { x: number; y: number; width: number; height: number }): void {
  element.getBoundingClientRect = () => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => ({}),
  }) as DOMRect;
}

test("createElementTrackingOverlayAnchor derives position from the element plus its own scroll offsets", () => {
  const dom = new JSDOM("<body><div id='reader'><img id='page' /></div></body>");
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  const reader = document.getElementById("reader")!;
  stubElementRect(reader, { x: 0, y: 40, width: 500, height: 800 });

  const anchor = createElementTrackingOverlayAnchor(reader, { x: 60, y: 120, width: 300, height: 200 });
  const rect = anchor.getBoundingClientRect();
  assert.equal(rect.x, 60);
  assert.equal(rect.y, 160);

  // The reader container scrolls internally: its content shifts up while window.scrollY stays 0.
  Object.defineProperty(reader, "scrollTop", { value: 250, configurable: true });
  const afterScroll = anchor.getBoundingClientRect();
  assert.equal(afterScroll.x, 60);
  assert.equal(afterScroll.y, -90);
  assert.equal(afterScroll.bottom, 110);

  // The reader itself moves in the viewport (window scroll or layout shift): anchor follows.
  stubElementRect(reader, { x: 0, y: -200, width: 500, height: 800 });
  const afterMove = anchor.getBoundingClientRect();
  assert.equal(afterMove.y, -330);
});
