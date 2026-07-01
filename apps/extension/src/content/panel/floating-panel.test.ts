import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { FloatingPanel } from "./floating-panel.js";

test("FloatingPanel renders a compact translate button", () => {
  setupDom();
  let translated = false;
  const panel = new FloatingPanel({ onTranslateCurrent: () => { translated = true; } });
  panel.mount();

  const button = document.querySelector<HTMLButtonElement>("[data-umt-floating-button]")!;
  assert.equal(button.textContent?.includes("\u7ffb\u8bd1"), true);
  button.click();
  assert.equal(translated, true);
});

test("FloatingPanel updates status and visibility", () => {
  setupDom();
  const panel = new FloatingPanel({ onTranslateCurrent: () => undefined });
  panel.mount();

  panel.setStatus("\u7ffb\u8bd1\u4e2d", "busy");
  assert.equal(document.querySelector<HTMLElement>("[data-umt-status]")?.textContent, "\u7ffb\u8bd1\u4e2d");
  assert.equal(panel.root.dataset.state, "busy");

  panel.setEnabled(false);
  assert.equal(panel.root.style.display, "none");
  panel.setEnabled(true);
  assert.equal(panel.root.style.display, "");
});

function setupDom(): void {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.com" });
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
}