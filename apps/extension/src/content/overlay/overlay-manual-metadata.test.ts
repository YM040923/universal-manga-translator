import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { ManualOverridePayload } from "@umt/shared/protocol";
import { OverlayRenderer } from "./overlay-renderer.js";

test("manual edit payload records source text and natural bubble geometry for v2 reconciliation", () => {
  const dom = new JSDOM("<body><img /></body>", { url: "https://example.test" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.CSS = dom.window.CSS;
  const image = document.querySelector("img")!;
  image.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, width: 500, height: 1000, right: 500, bottom: 1000, toJSON: () => ({}) }) as DOMRect;
  let saved: ManualOverridePayload | undefined;
  window.prompt = () => "manual edit";
  const renderer = new OverlayRenderer({ targetLanguage: "zh-CN", onManualEdit: (override) => { saved = override; } });
  renderer.render(image, { width: 1000, height: 2000 }, {
    surfaceId: "s1", imageHash: "hash", status: "completed", providerProfile: "test", layoutVersion: 1, elapsedMs: 1,
    regions: [{ id: "r1", box: { x: 10, y: 20, width: 200, height: 80 }, sourceText: "HELLO", translatedText: "machine", confidence: 1, orientation: "horizontal", kind: "dialogue", style: { fontSize: 16, writingMode: "horizontal-tb", align: "center", background: "#fff", color: "#111" } }],
  });

  document.querySelector<HTMLElement>("[data-umt-text-chip='true']")!.click();

  assert.equal((saved as any)?.sourceText, "HELLO");
  assert.deepEqual((saved as any)?.box, { x: 10, y: 20, width: 200, height: 80 });
});