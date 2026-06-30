import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { FloatingPanel } from "./floating-panel.js";

test("FloatingPanel shows optional settings button", () => {
  const dom = new JSDOM(`<body></body>`);
  globalThis.document = dom.window.document;
  let opened = false;
  const panel = new FloatingPanel({
    onTranslateCurrent: () => undefined,
    onRescan: () => undefined,
    onToggleOverlays: () => undefined,
    onTogglePause: () => undefined,
    onOpenSettings: () => { opened = true; },
  });
  panel.mount();
  const buttons = [...document.querySelectorAll("button")];
  const settings = buttons.find((button) => button.textContent === "Settings")!;
  settings.click();
  assert.equal(opened, true);
});