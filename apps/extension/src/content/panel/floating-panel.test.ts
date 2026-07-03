import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { FloatingPanel } from "./floating-panel.js";

test("FloatingPanel renders one compact primary button by default", () => {
  setupDom();
  const panel = new FloatingPanel({ onToggleOverlayVisibility: () => undefined });
  panel.mount();

  const primary = document.querySelector<HTMLButtonElement>("[data-umt-floating-button]")!;
  assert.equal(Boolean(primary), true);
  assert.equal(document.querySelector<HTMLElement>("[data-umt-eye-icon]")?.textContent, "◉");
  assert.equal(document.querySelector<HTMLElement>("[data-umt-eye-label]"), null);
  assert.equal(document.querySelector<HTMLElement>("[data-umt-status-dot]"), null);
  assert.equal(document.querySelector<HTMLElement>("[data-umt-drag-handle]"), null);
  assert.equal(primary.title, "隐藏翻译气泡");
  assert.equal(document.querySelectorAll("[data-umt-panel] button").length, 1);
  assert.equal(document.querySelector("[data-umt-floating-menu]"), null);
  assert.equal(primary.style.width, "42px");
  assert.equal(primary.style.height, "42px");
});

test("FloatingPanel left click toggles translation overlay visibility", () => {
  setupDom();
  const calls: boolean[] = [];
  const panel = new FloatingPanel({ onToggleOverlayVisibility: (next) => calls.push(next) });
  panel.mount();
  panel.setOverlayVisible(true);

  document.querySelector<HTMLButtonElement>("[data-umt-floating-button]")!.click();

  assert.deepEqual(calls, [false]);
  panel.setOverlayVisible(false);
  const primary = document.querySelector<HTMLButtonElement>("[data-umt-floating-button]")!;
  assert.equal(document.querySelector<HTMLElement>("[data-umt-eye-icon]")?.textContent, "◌");
  assert.equal(document.querySelector<HTMLElement>("[data-umt-eye-label]"), null);
  assert.equal(primary.style.filter, "grayscale(0.85)");
  assert.equal(primary.title, "显示翻译气泡");
});

test("FloatingPanel work state does not add extra badges to the clean eye button", () => {
  setupDom();
  const panel = new FloatingPanel({ onToggleOverlayVisibility: () => undefined });
  panel.mount();

  panel.setStatus("翻译中", "busy");
  assert.equal(document.querySelector<HTMLElement>("[data-umt-status-dot]"), null);
  assert.equal(document.querySelector<HTMLElement>("[data-umt-eye-icon]")?.textContent, "◉");

  panel.setStatus("失败", "error");
  assert.equal(document.querySelector<HTMLElement>("[data-umt-status-dot]"), null);
});

test("FloatingPanel right click opens compact menu for retranslate and selection", () => {
  setupDom();
  let retranslates = 0;
  let selects = 0;
  const panel = new FloatingPanel({
    onToggleOverlayVisibility: () => undefined,
    onRetranslatePage: () => { retranslates += 1; },
    onSelectRegion: () => { selects += 1; },
  });
  panel.mount();

  const primary = document.querySelector<HTMLButtonElement>("[data-umt-floating-button]")!;
  primary.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

  const menu = document.querySelector<HTMLElement>("[data-umt-floating-menu]")!;
  assert.equal(Boolean(menu), true);
  assert.equal(menu.hidden, false);
  assert.equal(document.querySelector<HTMLButtonElement>("[data-umt-retranslate-button]")?.textContent, "重翻本页");
  assert.equal(document.querySelector<HTMLButtonElement>("[data-umt-select-button]")?.textContent, "框选翻译");

  document.querySelector<HTMLButtonElement>("[data-umt-retranslate-button]")!.click();
  assert.equal(retranslates, 1);
  assert.equal(menu.hidden, true);

  primary.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  document.querySelector<HTMLButtonElement>("[data-umt-select-button]")!.click();
  assert.equal(selects, 1);
  assert.equal(menu.hidden, true);
});

test("FloatingPanel updates status and visibility without expanding visible footprint", () => {
  setupDom();
  const panel = new FloatingPanel({ onToggleOverlayVisibility: () => undefined });
  panel.mount();

  panel.setStatus("翻译中", "busy");
  assert.equal(document.querySelector<HTMLElement>("[data-umt-status]")?.textContent, "处理中");
  assert.equal(panel.root.dataset.state, "busy");

  panel.setEnabled(false);
  assert.equal(panel.root.style.display, "none");
  panel.setEnabled(true);
  assert.equal(panel.root.style.display, "");
});

test("FloatingPanel keeps button stable when status text is long", () => {
  setupDom();
  const panel = new FloatingPanel({ onToggleOverlayVisibility: () => undefined });
  panel.mount();

  panel.setStatus("UMT：已排队 5 个 | 正在处理 0 个 | 已完成 4 个 | 为空 0 个 | 失败 4 个", "done");

  const button = document.querySelector<HTMLButtonElement>("[data-umt-floating-button]")!;
  const status = document.querySelector<HTMLElement>("[data-umt-status]")!;
  assert.equal(button.style.width, "42px");
  assert.equal(button.style.height, "42px");
  assert.equal(status.textContent, "完成");
  assert.equal(button.title.includes("已排队 5 个"), true);
});

test("FloatingPanel can be dragged freely and persists its position without firing primary action", () => {
  setupDom();
  const saved: Record<string, unknown> = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => saved,
        set: async (value: Record<string, unknown>) => { Object.assign(saved, value); },
      },
    },
  } as unknown as typeof chrome;
  let toggles = 0;
  const panel = new FloatingPanel({ onToggleOverlayVisibility: () => { toggles += 1; } });
  panel.mount();

  const primary = document.querySelector<HTMLButtonElement>("[data-umt-floating-button]")!;
  primary.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
  document.dispatchEvent(new MouseEvent("pointermove", { clientX: 60, clientY: 40, bubbles: true }));
  document.dispatchEvent(new MouseEvent("pointerup", { clientX: 60, clientY: 40, bubbles: true }));
  primary.click();

  assert.equal(panel.root.style.left, "934px");
  assert.equal(panel.root.style.top, "658px");
  assert.equal(panel.root.style.right, "auto");
  assert.equal(panel.root.style.bottom, "auto");
  assert.deepEqual(saved.umtFloatingPanelPosition, { left: 934, top: 658 });
  assert.equal(toggles, 0);
});

function setupDom(): void {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.com" });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.PointerEvent = dom.window.MouseEvent as unknown as typeof PointerEvent;
  Object.defineProperty(dom.window, "innerWidth", { value: 1024, configurable: true });
  Object.defineProperty(dom.window, "innerHeight", { value: 768, configurable: true });
  delete (globalThis as { chrome?: typeof chrome }).chrome;
}


