import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ManualSelectionController } from "./manual-selection.js";

test("ManualSelectionController reports drag rectangle and removes layer", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://manga.example" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.MouseEvent = dom.window.MouseEvent;
  let selected: unknown;
  const controller = new ManualSelectionController({ onSelect: (rect: unknown) => { selected = rect; } });

  controller.start();
  const layer = document.querySelector<HTMLElement>("[data-umt-selection-layer]")!;
  layer.dispatchEvent(new dom.window.MouseEvent("mousedown", { clientX: 30, clientY: 40, bubbles: true }));
  layer.dispatchEvent(new dom.window.MouseEvent("mousemove", { clientX: 130, clientY: 240, bubbles: true }));
  layer.dispatchEvent(new dom.window.MouseEvent("mouseup", { clientX: 130, clientY: 240, bubbles: true }));

  assert.deepEqual(selected, { x: 30, y: 40, width: 100, height: 200 });
  assert.equal(document.querySelector("[data-umt-selection-layer]"), null);
});

test("ManualSelectionController ignores tiny selections", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://manga.example" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.MouseEvent = dom.window.MouseEvent;
  let called = false;
  const controller = new ManualSelectionController({ onSelect: () => { called = true; }, minSize: 20 });

  controller.start();
  const layer = document.querySelector<HTMLElement>("[data-umt-selection-layer]")!;
  layer.dispatchEvent(new dom.window.MouseEvent("mousedown", { clientX: 10, clientY: 10, bubbles: true }));
  layer.dispatchEvent(new dom.window.MouseEvent("mouseup", { clientX: 15, clientY: 15, bubbles: true }));

  assert.equal(called, false);
});

test("ManualSelectionController keeps selection mode scrollable and cancels a cross-viewport drag", () => {
  const dom = new JSDOM("<!doctype html><html><body><button id='reader-control'>reader</button></body></html>", { url: "https://manga.example" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.MouseEvent = dom.window.MouseEvent;
  let selected: unknown;
  const controller = new ManualSelectionController({ onSelect: (rect: unknown) => { selected = rect; } });

  controller.start();
  const layer = document.querySelector<HTMLElement>("[data-umt-selection-layer]")!;
  assert.equal(layer.style.pointerEvents, "none");

  document.dispatchEvent(new dom.window.MouseEvent("mousedown", { clientX: 30, clientY: 40, button: 0, bubbles: true }));
  window.dispatchEvent(new dom.window.Event("scroll"));
  document.dispatchEvent(new dom.window.MouseEvent("mouseup", { clientX: 130, clientY: 240, button: 0, bubbles: true }));

  assert.equal(selected, undefined);
  assert.equal(document.querySelector("[data-umt-selection-layer]"), layer);
  assert.match(layer.textContent ?? "", /滚动定位后/);

  document.dispatchEvent(new dom.window.MouseEvent("mousedown", { clientX: 30, clientY: 40, button: 0, bubbles: true }));
  document.dispatchEvent(new dom.window.MouseEvent("mouseup", { clientX: 130, clientY: 240, button: 0, bubbles: true }));
  assert.deepEqual(selected, { x: 30, y: 40, width: 100, height: 200 });
});

