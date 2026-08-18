import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { resolveSelectionContentAnchor } from "./selection-anchor.js";

function stubRect(element: HTMLElement, rect: { x: number; y: number; width: number; height: number }): void {
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

function setupDom(): JSDOM {
  const dom = new JSDOM(`<body>
    <div id="reader"><img id="page" src="https://example.test/page.jpg" /></div>
  </body>`, { url: "https://example.test/chapter/1" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  return dom;
}

test("resolveSelectionContentAnchor anchors to the element under the selection point", () => {
  setupDom();
  const reader = document.getElementById("reader")!;
  stubRect(reader, { x: 0, y: 0, width: 600, height: 900 });
  document.elementFromPoint = () => reader;

  const { element, contentRect } = resolveSelectionContentAnchor({ x: 50, y: 80, width: 200, height: 150 });
  assert.equal(element, reader);
  assert.deepEqual(contentRect, { x: 50, y: 80, width: 200, height: 150 });
});

test("resolveSelectionContentAnchor converts selection rect into content coordinates of a scrolled container", () => {
  setupDom();
  const reader = document.getElementById("reader")!;
  stubRect(reader, { x: 0, y: 0, width: 600, height: 900 });
  Object.defineProperty(reader, "scrollTop", { value: 300, configurable: true });
  document.elementFromPoint = () => reader;

  const { contentRect } = resolveSelectionContentAnchor({ x: 50, y: 400, width: 200, height: 150 });
  assert.deepEqual(contentRect, { x: 50, y: 700, width: 200, height: 150 });
});

test("resolveSelectionContentAnchor skips UMT-owned overlay nodes and uses the underlying element", () => {
  setupDom();
  const reader = document.getElementById("reader")!;
  stubRect(reader, { x: 0, y: 0, width: 600, height: 900 });
  const chip = document.createElement("span");
  chip.dataset.umtTextChip = "true";
  reader.append(chip);
  document.elementFromPoint = () => chip;

  const { element } = resolveSelectionContentAnchor({ x: 50, y: 80, width: 200, height: 150 });
  assert.equal(element, reader);
});

test("resolveSelectionContentAnchor falls back to document.body when nothing is under the point", () => {
  setupDom();
  document.elementFromPoint = () => null;

  const { element } = resolveSelectionContentAnchor({ x: 50, y: 80, width: 200, height: 150 });
  assert.equal(element, document.body);
});
