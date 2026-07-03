import test from "node:test";
import assert from "node:assert/strict";
import { surfaceStatusView, type SurfaceStatus } from "./surface-state.js";

test("surfaceStatusView maps every surface state to Chinese label and color", () => {
  const cases: Array<[SurfaceStatus, string, string]> = [
    ["idle", "翻译", "#64748b"],
    ["queued", "排队", "#2563eb"],
    ["fetching", "取图", "#0891b2"],
    ["ocr", "OCR", "#7c3aed"],
    ["translating", "翻译中", "#ea580c"],
    ["rendering", "渲染", "#ca8a04"],
    ["completed", "完成", "#16a34a"],
    ["cached", "缓存", "#15803d"],
    ["empty", "空", "#a16207"],
    ["failed", "重试", "#dc2626"],
    ["paused", "暂停", "#475569"],
    ["cancelled", "取消", "#334155"],
  ];

  for (const [status, label, color] of cases) {
    const view = surfaceStatusView(status);
    assert.equal(view.label, label);
    assert.equal(view.color, color);
  }
});
