import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { ManualOverridePayload } from "@umt/shared/protocol";
import type { Rect, SurfaceResult } from "@umt/shared/types";
import { clearManualEdits, loadManualEdit, OverlayRenderer, saveManualEdit } from "./overlay-renderer.js";

test.beforeEach(() => {
  clearManualEdits();
});

test("renders translated regions over a surface", () => {
  const { img } = setupDomWithImage({ x: 10, y: 20, width: 500, height: 1000 });
  const renderer = new OverlayRenderer();
  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("s1"));
  assert.equal(document.querySelector("[data-umt-region-id='r1']")?.textContent, "hello translated");
});

test("refreshAll repositions overlays after surface layout changes", () => {
  let rect = { x: 10, y: 20, width: 500, height: 1000 };
  const { img } = setupDomWithImage(() => rect);
  const renderer = new OverlayRenderer();
  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("s1"));
  const before = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  assert.equal(before.style.left, "52px");
  assert.equal(before.style.top, "63px");

  rect = { x: 30, y: 60, width: 600, height: 1200 };
  renderer.refreshAll();

  const after = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  assert.equal(after.style.left, "80.4px");
  assert.equal(after.style.top, "111.6px");
});

test("refreshAll updates existing overlay nodes instead of recreating them during scroll/layout refresh", () => {
  let rect = { x: 10, y: 20, width: 500, height: 1000 };
  const { img } = setupDomWithImage(() => rect);
  const renderer = new OverlayRenderer();
  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("stable"));
  const before = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;

  rect = { x: 10, y: 40, width: 500, height: 1000 };
  renderer.refreshAll();

  const after = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  assert.equal(after, before);
  assert.equal(after.style.top, "83px");
});


test("legacy fixed viewport coordinate behavior is superseded by document scrolling", () => {
  const { img } = setupDomWithImage({ x: 10, y: 20, width: 500, height: 1000 });
  Object.defineProperty(window, "scrollX", { value: 100, configurable: true });
  Object.defineProperty(window, "scrollY", { value: 200, configurable: true });
  const renderer = new OverlayRenderer();

  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("fixed-scroll"));

  const root = document.querySelector<HTMLElement>("[data-umt-overlay-root='true']")!;
  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  assert.equal(root.style.position, "absolute");
  assert.equal(wrapper.style.left, "152px");
  assert.equal(wrapper.style.top, "263px");
});


test("uses document coordinates so overlays naturally scroll with the manga page", () => {
  const { img } = setupDomWithImage({ x: 10, y: 20, width: 500, height: 1000 });
  Object.defineProperty(window, "scrollX", { value: 100, configurable: true });
  Object.defineProperty(window, "scrollY", { value: 200, configurable: true });
  const renderer = new OverlayRenderer();

  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("document-scroll"));

  const root = document.querySelector<HTMLElement>("[data-umt-overlay-root='true']")!;
  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  assert.equal(root.style.position, "absolute");
  assert.equal(wrapper.style.left, "152px");
  assert.equal(wrapper.style.top, "263px");
});

test("uses rounded pill mask instead of square corners for speech bubbles", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 500, height: 500 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("pill-mask");
  result.regions = [{ ...result.regions[0]!, box: { x: 100, y: 100, width: 220, height: 80 } }];

  renderer.render(img, { width: 500, height: 500 }, result);

  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  assert.equal(wrapper.style.borderRadius, "999px");
})

test("render restores overlay visibility after the page was cleared", () => {
  const { img } = setupDomWithImage({ x: 10, y: 20, width: 500, height: 1000 });
  const renderer = new OverlayRenderer();

  renderer.setVisible(false);
  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("s1"));

  const root = document.querySelector<HTMLElement>("[data-umt-overlay-root='true']")!;
  assert.equal(root.style.display, "block");
  assert.equal(document.querySelector("[data-umt-region-id='r1']")?.textContent, "hello translated");
});

test("clearAll removes rendered nodes and frontend manual edit memory", () => {
  const { img } = setupDomWithImage({ x: 10, y: 20, width: 500, height: 1000 });
  const renderer = new OverlayRenderer();
  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("clear-all"));
  saveManualEdit("hash", "zh-CN", "r1", "stale edit");

  renderer.clearAll();

  assert.equal(document.querySelector("[data-umt-region-id='r1']"), null);
  assert.equal(loadManualEdit("hash", "zh-CN", "r1"), null);
});

test("stores manual edits by image hash and region id", () => {
  saveManualEdit("hash", "zh-CN", "r1", "edited text");
  assert.equal(loadManualEdit("hash", "zh-CN", "r1"), "edited text");
});


test("empty manual edit removes the translation bubble and stores a deleted marker", () => {
  const { img } = setupDomWithImage({ x: 10, y: 20, width: 500, height: 1000 });
  let saved: ManualOverridePayload | undefined;
  window.prompt = () => "   ";
  const renderer = new OverlayRenderer({ targetLanguage: "zh-CN", onManualEdit: (override) => { saved = override; } });
  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("delete-edit"));

  document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!.click();

  assert.equal(document.querySelector("[data-umt-region-id='r1']"), null);
  assert.equal(loadManualEdit("hash", "zh-CN", "r1"), "");
  assert.deepEqual(saved, { imageHash: "hash", targetLanguage: "zh-CN", regionId: "r1", translatedText: "" });

  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("delete-edit"));
  assert.equal(document.querySelector("[data-umt-region-id='r1']"), null);
});

test("manual edit callback receives override payload", () => {
  const { img } = setupDomWithImage({ x: 10, y: 20, width: 500, height: 1000 });
  let saved: ManualOverridePayload | undefined;
  window.prompt = () => "manual edit";
  const renderer = new OverlayRenderer({ targetLanguage: "zh-CN", onManualEdit: (override) => { saved = override; } });
  renderer.render(img, { width: 1000, height: 2000 }, fakeResult("s1"));

  document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!.click();

  assert.deepEqual(saved, { imageHash: "hash", targetLanguage: "zh-CN", regionId: "r1", translatedText: "manual edit" });
});

test("creating a replacement renderer removes the previous overlay root so old manual bubbles follow popup visibility", () => {
  const { img } = setupDomWithImage({ x: 10, y: 20, width: 500, height: 1000 });
  const first = new OverlayRenderer();
  first.render(img, { width: 1000, height: 2000 }, fakeResult("old-root"));

  const second = new OverlayRenderer({ replaceExistingRoot: true });
  second.render(img, { width: 1000, height: 2000 }, fakeResult("new-root"));
  second.setVisible(false);

  const roots = [...document.querySelectorAll<HTMLElement>("[data-umt-overlay-root='true']")];
  assert.equal(roots.length, 1);
  assert.equal(roots[0]?.style.display, "none");
});

test("manual selection overlays remove overlapping normal translation bubbles", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 500, height: 500 });
  const renderer = new OverlayRenderer();
  renderer.render(img, { width: 500, height: 500 }, fakeResult("page-1"));

  const manual = fakeResult("manual:selection-1");
  manual.regions = [{
    ...manual.regions[0]!,
    id: "manual-r1",
    box: { x: 92, y: 92, width: 220, height: 120 },
    translatedText: "manual selection wins",
  }];
  renderer.render(img, { width: 500, height: 500 }, manual);

  assert.equal(document.querySelector("[data-umt-surface-id='page-1'][data-umt-region-id='r1']"), null);
  assert.equal(document.querySelector("[data-umt-surface-id='manual:selection-1'][data-umt-region-id='manual-r1']")?.textContent, "manual selection wins");
});

test("normal translation cannot cover an existing manual selection overlay", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 500, height: 500 });
  const renderer = new OverlayRenderer();
  const manual = fakeResult("manual:selection-2");
  manual.regions = [{
    ...manual.regions[0]!,
    id: "manual-r1",
    box: { x: 92, y: 92, width: 220, height: 120 },
    translatedText: "cached manual selection",
  }];
  renderer.render(img, { width: 500, height: 500 }, manual);

  renderer.render(img, { width: 500, height: 500 }, fakeResult("page-2"));

  assert.equal(document.querySelector("[data-umt-surface-id='page-2'][data-umt-region-id='r1']"), null);
  assert.equal(document.querySelector("[data-umt-surface-id='manual:selection-2'][data-umt-region-id='manual-r1']")?.textContent, "cached manual selection");
});

test("normal translation outside a manual selection overlay is still rendered", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 500, height: 500 });
  const renderer = new OverlayRenderer();
  const manual = fakeResult("manual:selection-3");
  manual.regions = [{
    ...manual.regions[0]!,
    id: "manual-r1",
    box: { x: 10, y: 10, width: 60, height: 40 },
    translatedText: "manual corner",
  }];
  renderer.render(img, { width: 500, height: 500 }, manual);

  renderer.render(img, { width: 500, height: 500 }, fakeResult("page-3"));

  assert.equal(document.querySelector("[data-umt-surface-id='page-3'][data-umt-region-id='r1']")?.textContent, "hello translated");
  assert.equal(document.querySelector("[data-umt-surface-id='manual:selection-3'][data-umt-region-id='manual-r1']")?.textContent, "manual corner");
});

test("clearing a manual selection removes its protection area", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 500, height: 500 });
  const renderer = new OverlayRenderer();
  const manual = fakeResult("manual:selection-4");
  manual.regions = [{
    ...manual.regions[0]!,
    id: "manual-r1",
    box: { x: 92, y: 92, width: 220, height: 120 },
    translatedText: "temporary manual selection",
  }];
  renderer.render(img, { width: 500, height: 500 }, manual);

  renderer.clearSurface("manual:selection-4");
  renderer.render(img, { width: 500, height: 500 }, fakeResult("page-4"));

  assert.equal(document.querySelector("[data-umt-surface-id='page-4'][data-umt-region-id='r1']")?.textContent, "hello translated");
});

function setupDomWithImage(rect: Rect | (() => Rect)) {
  const dom = new JSDOM(`<body><img id="page" /></body>`, { url: "https://example.test" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.CSS = dom.window.CSS;
  const img = document.querySelector<HTMLImageElement>("#page")!;
  Object.defineProperty(img, "getBoundingClientRect", { value: () => (typeof rect === "function" ? rect() : rect) });
  return { dom, img };
}

function fakeResult(surfaceId: string): SurfaceResult {
  return {
    surfaceId,
    imageHash: "hash",
    status: "completed",
    providerProfile: "mock",
    layoutVersion: 1,
    elapsedMs: 1,
    regions: [{
      id: "r1",
      box: { x: 100, y: 100, width: 200, height: 100 },
      sourceText: "Hello",
      translatedText: "hello translated",
      confidence: 1,
      orientation: "horizontal",
      kind: "dialogue",
      style: { fontSize: 20, writingMode: "horizontal-tb", align: "center", background: "white", color: "black" },
    }],
  };
}

test("OverlayRenderer applies vertical writing mode from layout style", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 100, height: 100 });
  const renderer = new OverlayRenderer();
  renderer.render(img, { width: 100, height: 100 }, {
    surfaceId: "vertical-surface",
    imageHash: "vertical-hash",
    status: "completed",
    providerProfile: "mock",
    layoutVersion: 2,
    elapsedMs: 1,
    regions: [{
      id: "r1",
      box: { x: 0, y: 0, width: 50, height: 80 },
      sourceText: "縦",
      translatedText: "竖排",
      confidence: 1,
      orientation: "vertical",
      kind: "dialogue",
      style: { fontSize: 16, writingMode: "vertical-rl", align: "center", background: "white", color: "black" },
    }],
  });

  assert.equal((document.querySelector("[data-umt-text-chip='true']") as HTMLElement).style.writingMode, "vertical-rl");
});


test("clamps overlay boxes to the rendered surface and skips unusable boxes", () => {
  const { img } = setupDomWithImage({ x: 10, y: 20, width: 100, height: 100 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("clamped");
  result.regions = [
    { ...result.regions[0]!, id: "keep", box: { x: -10, y: 10, width: 40, height: 30 } },
    { ...result.regions[0]!, id: "skip", box: { x: 200, y: 200, width: 5, height: 5 } },
  ];

  renderer.render(img, { width: 100, height: 100 }, result);

  const keep = document.querySelector<HTMLElement>("[data-umt-region-id='keep']")!;
  assert.equal(keep.style.left, "10px");
  assert.equal(keep.style.top, "26px");
  assert.equal(keep.style.width, "34px");
  assert.equal(document.querySelector("[data-umt-region-id='skip']"), null);
});


test("renders adaptive white mask inside large provider box", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 500, height: 500 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("adaptive-chip");
  result.imageHash = "adaptive-hash";
  result.regions = [{ ...result.regions[0]!, translatedText: "?", box: { x: 0, y: 0, width: 500, height: 300 } }];

  renderer.render(img, { width: 500, height: 500 }, result);

  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  const chip = wrapper.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  assert.equal(wrapper.style.background, "rgb(255, 255, 255)");
  assert.equal(wrapper.style.minHeight, "");
  assert.equal(chip.textContent, "?");
  assert.equal(chip.style.width, "100%");
  assert.equal(chip.style.maxWidth, "100%");
});

test("adaptive white mask centers short text without overflowing", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 500, height: 500 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("tight-chip");
  result.imageHash = "tight-chip-hash";
  result.regions = [{ ...result.regions[0]!, translatedText: "嗯", box: { x: 0, y: 0, width: 400, height: 240 } }];

  renderer.render(img, { width: 500, height: 500 }, result);

  const chip = document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  assert.equal(chip.style.minHeight, "0");
  assert.equal(chip.style.display, "block");
  assert.equal(chip.style.whiteSpace, "pre");
});

test("renders translation as a white mask centered inside the original text block", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 500, height: 500 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("mask-block");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "那个邪恶微笑的恶魔会对那些挑衅他、引起他兴趣的人着迷。",
    box: { x: 100, y: 100, width: 300, height: 120 },
  }];

  renderer.render(img, { width: 500, height: 500 }, result);

  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  const chip = wrapper.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  assert.equal(wrapper.style.background, "rgb(255, 255, 255)");
  assert.equal(wrapper.style.overflow, "hidden");
  assert.equal(chip.style.display, "block");
  assert.equal(chip.style.width, "100%");
  assert.equal(chip.style.maxHeight, "100%");
  assert.equal(chip.style.whiteSpace, "pre");
});

test("uses larger readable font for short text in a large speech bubble", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 900, height: 900 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("large-short-text");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "你不是一直在找我吗？",
    box: { x: 100, y: 100, width: 520, height: 360 },
    style: { ...result.regions[0]!.style, fontSize: 22 },
  }];

  renderer.render(img, { width: 900, height: 900 }, result);

  const chip = document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  const size = Number(chip.style.fontSize.replace("px", ""));
  assert.equal(size >= 42, true);
  assert.equal(size <= 46, true);
});

test("shrinks long text enough to avoid vertical overlap in a medium bubble", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 900, height: 900 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("medium-long-text");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "This is a deliberately long translated sentence that must shrink enough to avoid overlap inside the bubble.",
    box: { x: 100, y: 100, width: 520, height: 300 },
    style: { ...result.regions[0]!.style, fontSize: 30 },
  }];

  renderer.render(img, { width: 900, height: 900 }, result);

  const chip = document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  const size = Number(chip.style.fontSize.replace("px", ""));
  assert.equal(size <= 28, true);
});

test("shrinks multi-line Chinese text enough for a shallow speech bubble without clipping", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 900, height: 900 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("shallow-cjk-text");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "这就是你如何追踪他人的灵魂能量。",
    box: { x: 180, y: 120, width: 540, height: 118 },
    style: { ...result.regions[0]!.style, fontSize: 46 },
  }];

  renderer.render(img, { width: 900, height: 900 }, result);

  const chip = document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  const size = Number(chip.style.fontSize.replace("px", ""));
  assert.equal(chip.style.display, "block");
  assert.equal(size <= 31, true);
});

test("clips dialogue masks to an ellipse so wide boxes do not paint square corners outside bubbles", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 900, height: 900 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("ellipse-dialogue-mask");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "有什么我们可以学的吗？",
    box: { x: 160, y: 120, width: 520, height: 260 },
    kind: "dialogue",
  }];

  renderer.render(img, { width: 900, height: 900 }, result);

  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  assert.equal(wrapper.style.clipPath.includes("ellipse"), true);
});

test("wide dialogue masks use a text-band shape instead of a giant ellipse", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 1200, height: 360 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("wide-dialogue-band-mask");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "我现在只觉得很有存款。",
    box: { x: 40, y: 40, width: 1120, height: 230 },
    kind: "dialogue",
    style: { ...result.regions[0]!.style, fontSize: 48 },
  }];

  renderer.render(img, { width: 1200, height: 360 }, result);

  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  assert.equal(wrapper.style.clipPath.includes("ellipse"), false);
  assert.equal(wrapper.style.borderRadius, "18px");
});

test("wide Chinese dialogue uses the available width instead of becoming a narrow column", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 1000, height: 420 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("wide-chinese-no-column");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "他确实不就一个菜鸟。",
    box: { x: 60, y: 60, width: 820, height: 260 },
    kind: "dialogue",
    style: { ...result.regions[0]!.style, fontSize: 52 },
  }];

  renderer.render(img, { width: 1000, height: 420 }, result);

  const chip = document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  assert.equal((chip.textContent ?? "").split("\n").length <= 2, true);
});

test("long wide Chinese dialogue remains a horizontal block with balanced two-line layout", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 1000, height: 420 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("wide-chinese-balanced-two-lines");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "结果只来了一个云家小鬼，全体白忙一场。",
    box: { x: 50, y: 40, width: 900, height: 300 },
    kind: "dialogue",
    style: { ...result.regions[0]!.style, fontSize: 52 },
  }];

  renderer.render(img, { width: 1000, height: 420 }, result);

  const lines = (document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!.textContent ?? "").split("\n");
  assert.equal(lines.length, 2);
  assert.equal(Math.abs(Array.from(lines[0]!).length - Array.from(lines[1]!).length) <= 4, true);
});

test("renders sfx/action lettering without a huge opaque speech-bubble mask", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 800, height: 7165 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("sfx-mask");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "太阳\n神拳",
    kind: "sfx",
    box: { x: 1, y: 1011, width: 354, height: 610 },
  }];

  renderer.render(img, { width: 800, height: 7165 }, result);

  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  const chip = wrapper.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  assert.equal(wrapper.style.background, "rgba(255, 255, 255, 0.28)");
  assert.equal(wrapper.style.clipPath, "none");
  assert.equal(chip.style.textShadow.includes("rgba(255,255,255,0.95)"), true);
});





test("merges overlapping split text regions before rendering to avoid stacked bubbles", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 800, height: 620 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("split-caption-merge");
  result.regions = [
    {
      ...result.regions[0]!,
      id: "top",
      translatedText: "\u9996\u5148\uff0c\n\u90a3\u4e9b\u6df7\u86cb",
      box: { x: 260, y: 120, width: 280, height: 180 },
      kind: "narration",
    },
    {
      ...result.regions[0]!,
      id: "bottom",
      translatedText: "\u8fd0\u7528\u7075\u9b42\u80fd\u91cf\u7684\u65b9\u5f0f\n\u7075\u9b42\u80fd\u91cf\u3002",
      box: { x: 180, y: 250, width: 440, height: 250 },
      kind: "narration",
    },
  ];

  renderer.render(img, { width: 800, height: 620 }, result);

  const wrappers = document.querySelectorAll<HTMLElement>("[data-umt-region-id]");
  assert.equal(wrappers.length, 1);
  assert.equal(wrappers[0]!.textContent!.includes("\u9996\u5148"), true);
  assert.equal(wrappers[0]!.textContent!.includes("\u7075\u9b42\u80fd\u91cf"), true);
  assert.equal(wrappers[0]!.textContent!.includes("\\n"), false);
  assert.equal(wrappers[0]!.textContent!.includes("\n"), true);
});

test("adds glyph-safe inset for large CJK text so strokes are not clipped", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 700, height: 540 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("glyph-safe-cjk");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "\u4e8e\u662f\uff0c\u5728\u51fa\n\u53d1\u7684\u90a3\u4e00\u5929...\n...",
    box: { x: 20, y: 20, width: 670, height: 520 },
    kind: "narration",
    style: { ...result.regions[0]!.style, fontSize: 58 },
  }];

  renderer.render(img, { width: 700, height: 540 }, result);

  const chip = document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  assert.equal(chip.style.paddingTop !== "0px", true);
  assert.equal(chip.style.overflow, "visible");
  assert.equal(chip.style.maxHeight, "none");
});

test("expands mask slightly around OCR text box to cover original glyph edges", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 500, height: 500 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("expanded-mask");
  result.regions = [{ ...result.regions[0]!, box: { x: 100, y: 100, width: 100, height: 50 } }];

  renderer.render(img, { width: 500, height: 500 }, result);

  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  assert.equal(wrapper.style.left, "92px");
  assert.equal(wrapper.style.top, "93px");
  assert.equal(wrapper.style.width, "116px");
  assert.equal(wrapper.style.height, "64px");
});

test("lays out Chinese dialogue into stable balanced lines without orphan punctuation", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 900, height: 520 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("stable-cjk-layout");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "上次和你一起执行任务，我学到了很多，前辈。",
    box: { x: 40, y: 30, width: 820, height: 420 },
    kind: "dialogue",
    style: { ...result.regions[0]!.style, fontSize: 48 },
  }];

  renderer.render(img, { width: 900, height: 520 }, result);

  const chip = document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  const lines = (chip.textContent ?? "").split("\n");
  assert.equal(lines.length >= 2, true);
  assert.equal(lines.some((line) => /^[，。、！？：；,.!?]/u.test(line) || /[，、]$/u.test(line)), false);
  assert.equal(chip.dataset.umtLayoutKey?.includes("上次和你一起执行任务"), true);
  assert.equal(chip.style.whiteSpace, "pre");
});

test("refreshAll keeps identical text layout DOM-stable to prevent flicker", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 900, height: 520 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("no-flicker-layout");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "好强大的气场……！",
    box: { x: 90, y: 70, width: 700, height: 330 },
    kind: "dialogue",
    style: { ...result.regions[0]!.style, fontSize: 52 },
  }];

  renderer.render(img, { width: 900, height: 520 }, result);
  const chip = document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  const firstTextNode = chip.firstChild;
  const firstStyle = chip.getAttribute("style");
  const firstLayoutKey = chip.dataset.umtLayoutKey;

  renderer.refreshAll();

  assert.equal(chip.firstChild, firstTextNode);
  assert.equal(chip.getAttribute("style"), firstStyle);
  assert.equal(chip.dataset.umtLayoutKey, firstLayoutKey);
});

test("overlay appearance options can force rounded masks and scale font and mask", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 500, height: 500 });
  const renderer = new OverlayRenderer({
    appearance: {
      maskShape: "rounded",
      fontScale: 1.2,
      maskScale: 1.2,
      opacity: 0.7,
    },
  });
  const result = fakeResult("appearance-options");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "\u6d4b\u8bd5",
    box: { x: 100, y: 100, width: 100, height: 50 },
    kind: "dialogue",
    style: { ...result.regions[0]!.style, fontSize: 20 },
  }];

  renderer.render(img, { width: 500, height: 500 }, result);

  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  const chip = wrapper.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  assert.equal(wrapper.style.clipPath.includes("ellipse"), false);
  assert.equal(wrapper.style.opacity, "0.7");
  assert.equal(wrapper.style.left, "88px");
  assert.equal(wrapper.style.top, "90px");
  assert.equal(wrapper.style.width, "124px");
  assert.equal(wrapper.style.height, "70px");
  assert.equal(Number(chip.style.fontSize.replace("px", "")) > 20, true);
});

test("overlay appearance can be updated and re-render existing bubbles without recreating text nodes", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 500, height: 500 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("appearance-update");
  renderer.render(img, { width: 500, height: 500 }, result);
  const chip = document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  const firstTextNode = chip.firstChild;

  renderer.setAppearance({ maskShape: "transparent", fontScale: 0.9, maskScale: 0.8, opacity: 0.5 });

  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  assert.equal(chip.firstChild, firstTextNode);
  assert.equal(wrapper.style.background, "transparent");
  assert.equal(wrapper.style.opacity, "0.5");
});

test("ellipse appearance controls forced and automatic dialogue ellipse aspect ratio", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 800, height: 800 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("ellipse-aspect-controls");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "\u4f60\u597d",
    box: { x: 180, y: 160, width: 360, height: 180 },
    kind: "dialogue",
    style: { ...result.regions[0]!.style, fontSize: 24 },
  }];

  renderer.setAppearance({ maskShape: "ellipse", fontScale: 1, maskScale: 1, ellipseX: 42, ellipseY: 36, opacity: 1 });
  renderer.render(img, { width: 800, height: 800 }, result);
  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  assert.equal(wrapper.style.clipPath, "ellipse(42% 36% at 50% 50%)");

  renderer.setAppearance({ maskShape: "auto", fontScale: 1, maskScale: 1, ellipseX: 44, ellipseY: 38, opacity: 1 });
  assert.equal(wrapper.style.clipPath, "ellipse(44% 38% at 50% 50%)");
});

test("font scale directly changes rendered font size on an existing bubble", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 800, height: 800 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("font-scale-direct");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "\u4f60\u597d",
    box: { x: 100, y: 100, width: 360, height: 180 },
    kind: "dialogue",
    style: { ...result.regions[0]!.style, fontSize: 24 },
  }];
  renderer.render(img, { width: 800, height: 800 }, result);
  const chip = document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  const baseFont = Number(chip.style.fontSize.replace("px", ""));

  renderer.setAppearance({ maskShape: "auto", fontScale: 1.3, maskScale: 1, opacity: 1 });
  const largerFont = Number(chip.style.fontSize.replace("px", ""));

  assert.equal(largerFont > baseFont + 4, true);
});

test("mask scale changes mask size without changing rendered font size", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 800, height: 800 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("mask-scale-independent");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "\u4f60\u597d",
    box: { x: 200, y: 200, width: 200, height: 100 },
    kind: "dialogue",
    style: { ...result.regions[0]!.style, fontSize: 24 },
  }];
  renderer.render(img, { width: 800, height: 800 }, result);
  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  const chip = wrapper.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  const baseFont = chip.style.fontSize;
  const baseWidth = Number(wrapper.style.width.replace("px", ""));

  renderer.setAppearance({ maskShape: "auto", fontScale: 1, maskScale: 1.8, opacity: 1 });

  const largerWidth = Number(wrapper.style.width.replace("px", ""));
  assert.equal(chip.style.fontSize, baseFont);
  assert.equal(largerWidth >= baseWidth + 40, true);
});

test("very small mask scale can shrink the mask below the OCR text box without changing font size", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 800, height: 800 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("mask-scale-smaller-minimum");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "\u4f60\u597d",
    box: { x: 200, y: 200, width: 200, height: 100 },
    kind: "dialogue",
    style: { ...result.regions[0]!.style, fontSize: 24 },
  }];
  renderer.render(img, { width: 800, height: 800 }, result);
  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  const chip = wrapper.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  const baseFont = chip.style.fontSize;

  renderer.setAppearance({ maskShape: "auto", fontScale: 1, maskScale: 0.2, opacity: 1 });

  const smallerWidth = Number(wrapper.style.width.replace("px", ""));
  const smallerHeight = Number(wrapper.style.height.replace("px", ""));
  assert.equal(chip.style.fontSize, baseFont);
  assert.equal(smallerWidth <= 170, true);
  assert.equal(smallerHeight <= 85, true);
});

test("very small mask scale shrinks wide dialogue masks horizontally enough", () => {
  const { img } = setupDomWithImage({ x: 0, y: 0, width: 1000, height: 500 });
  const renderer = new OverlayRenderer();
  const result = fakeResult("mask-scale-wide-horizontal");
  result.regions = [{
    ...result.regions[0]!,
    translatedText: "\u4f60\u597d",
    box: { x: 100, y: 100, width: 640, height: 140 },
    kind: "dialogue",
    style: { ...result.regions[0]!.style, fontSize: 24 },
  }];
  renderer.render(img, { width: 1000, height: 500 }, result);
  const wrapper = document.querySelector<HTMLElement>("[data-umt-region-id='r1']")!;
  const chip = wrapper.querySelector<HTMLElement>("[data-umt-text-chip='true']")!;
  const baseFont = chip.style.fontSize;

  renderer.setAppearance({ maskShape: "auto", fontScale: 1, maskScale: 0.2, opacity: 1 });

  const smallerWidth = Number(wrapper.style.width.replace("px", ""));
  assert.equal(chip.style.fontSize, baseFont);
  assert.equal(smallerWidth <= 390, true);
});
