import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ChapterProgress } from "./chapter-progress.js";

function setupDom(): void {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://reader.example/chapter/1", pretendToBeVisual: true });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.MouseEvent = dom.window.MouseEvent;
  const storage: Record<string, unknown> = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key: string) { return { [key]: storage[key] }; },
        async set(value: Record<string, unknown>) { Object.assign(storage, value); },
      },
    },
  } as unknown as typeof chrome;
}

test("ChapterProgress mounts a draggable translucent widget and renders counts", async () => {
  setupDom();
  const widget = new ChapterProgress();

  await widget.mount();
  widget.update({ total: 5, queued: 2, processing: 1, completed: 1, cached: 1, empty: 0, failed: 0, cancelled: 0, paused: false });

  const root = document.querySelector<HTMLElement>("[data-umt-chapter-progress='true']")!;
  assert.ok(root);
  assert.equal(root.style.position, "fixed");
  assert.equal(root.style.opacity, "0.55");
  assert.match(root.textContent ?? "", /5/);
  assert.match(root.textContent ?? "", /完成 1/);
  assert.match(root.textContent ?? "", /缓存 1/);
  assert.match(root.textContent ?? "", /处理中 1/);
  const bar = document.querySelector<HTMLElement>("[data-umt-progress-bar='true']")!;
  assert.equal(bar.style.width, "40%");
  assert.equal(root.dataset.progressState, "running");
});

test("ChapterProgress includes cancelled jobs in terminal progress and state", async () => {
  setupDom();
  const widget = new ChapterProgress();

  await widget.mount();
  widget.update({ total: 4, queued: 0, processing: 0, completed: 1, cached: 0, empty: 0, failed: 1, cancelled: 2, paused: false });

  const root = document.querySelector<HTMLElement>("[data-umt-chapter-progress='true']")!;
  const bar = document.querySelector<HTMLElement>("[data-umt-progress-bar='true']")!;
  assert.match(root.textContent ?? "", /取消 2/);
  assert.equal(bar.style.width, "100%");
  assert.equal(root.dataset.progressState, "failed");
});

test("ChapterProgress can be reset to an idle waiting state", async () => {
  setupDom();
  const widget = new ChapterProgress();
  await widget.mount();
  widget.update({ total: 4, queued: 0, processing: 0, completed: 4, cached: 0, empty: 0, failed: 0, cancelled: 0, paused: false });

  widget.reset("等待开始");

  const root = document.querySelector<HTMLElement>("[data-umt-chapter-progress='true']")!;
  const bar = document.querySelector<HTMLElement>("[data-umt-progress-bar='true']")!;
  assert.equal(root.dataset.progressState, "idle");
  assert.equal(bar.style.width, "0%");
  assert.match(root.textContent ?? "", /等待开始/);
});

test("ChapterProgress folds to a dot and persists drag position", async () => {
  setupDom();
  const widget = new ChapterProgress({ storageKey: "progress-test" });
  await widget.mount();

  document.querySelector<HTMLButtonElement>("[data-action='toggle-fold']")!.click();
  assert.equal(document.querySelector<HTMLElement>("[data-umt-chapter-progress='true']")!.dataset.folded, "true");

  const root = document.querySelector<HTMLElement>("[data-umt-chapter-progress='true']")!;
  root.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 100, bubbles: true }));
  window.dispatchEvent(new MouseEvent("mousemove", { clientX: 130, clientY: 145, bubbles: true }));
  window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  const remounted = new ChapterProgress({ storageKey: "progress-test" });
  await remounted.mount();
  const roots = document.querySelectorAll<HTMLElement>("[data-umt-chapter-progress='true']");
  const next = roots[roots.length - 1]!;
  assert.equal(next.style.left, "48px");
  assert.equal(next.style.top, "125px");
});
