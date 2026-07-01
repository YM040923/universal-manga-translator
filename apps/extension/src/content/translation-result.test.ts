import test from "node:test";
import assert from "node:assert/strict";
import { isRenderableSurfaceResult } from "./translation-result.js";

test("isRenderableSurfaceResult rejects empty results so screenshot fallback can run", () => {
  assert.equal(isRenderableSurfaceResult(undefined), false);
  assert.equal(isRenderableSurfaceResult({
    surfaceId: "s1",
    imageHash: "hash",
    status: "empty",
    regions: [],
    providerProfile: "test",
    layoutVersion: 1,
    elapsedMs: 1,
  }), false);
});

test("isRenderableSurfaceResult accepts completed results with overlay regions", () => {
  assert.equal(isRenderableSurfaceResult({
    surfaceId: "s1",
    imageHash: "hash",
    status: "completed",
    providerProfile: "test",
    layoutVersion: 1,
    elapsedMs: 1,
    regions: [{
      id: "r1",
      box: { x: 1, y: 2, width: 30, height: 40 },
      sourceText: "hi",
      translatedText: "你好",
      confidence: 1,
      orientation: "horizontal",
      kind: "dialogue",
      style: { fontSize: 14, writingMode: "horizontal-tb", align: "center", background: "white", color: "black" },
    }],
  }), true);
});
