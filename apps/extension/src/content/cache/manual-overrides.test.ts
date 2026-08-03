import test from "node:test";
import assert from "node:assert/strict";
import { applyManualOverridesToResult } from "./manual-overrides.js";

test("manual edits and deletion tombstones survive bubble coordinate drift", () => {
  const edited = applyManualOverridesToResult(result(), [{
    imageHash: "hash",
    targetLanguage: "zh-CN",
    regionId: "old-region",
    translatedText: "人工修正",
    sourceText: "HELLO WORLD",
    box: { x: 100, y: 200, width: 200, height: 80 },
    neighborhood: ["before", "after"],
  }] as any);
  assert.equal(edited.regions[0]?.translatedText, "人工修正");

  const deleted = applyManualOverridesToResult(result(), [{
    imageHash: "hash",
    targetLanguage: "zh-CN",
    regionId: "old-region",
    translatedText: "",
    sourceText: "HELLO WORLD",
    box: { x: 100, y: 200, width: 200, height: 80 },
    neighborhood: ["before", "after"],
  }] as any);
  assert.deepEqual(deleted.regions, []);
});

function result() {
  return {
    surfaceId: "s1",
    imageHash: "hash",
    status: "completed" as const,
    providerProfile: "test",
    layoutVersion: 1,
    elapsedMs: 1,
    regions: [{
      id: "new-region",
      box: { x: 112, y: 205, width: 200, height: 80 },
      sourceText: "hello   world",
      translatedText: "machine",
      confidence: 1,
      orientation: "horizontal" as const,
      kind: "dialogue" as const,
      style: { fontSize: 16, writingMode: "horizontal-tb" as const, align: "center" as const, background: "#fff", color: "#111" },
    }],
  };
}