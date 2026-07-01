import test from "node:test";
import assert from "node:assert/strict";
import { layoutRegions } from "./layout.js";
import type { TextRegion } from "@umt/shared";

function region(patch: Partial<TextRegion> = {}): TextRegion {
  return {
    id: "r1",
    box: { x: 0, y: 0, width: 80, height: 80 },
    sourceText: "hello",
    translatedText: "short",
    confidence: 1,
    orientation: "horizontal",
    kind: "dialogue",
    ...patch,
  };
}

test("layoutRegions uses vertical writing mode for vertical regions", () => {
  const laidOut = layoutRegions([region({ orientation: "vertical" })])[0]!;
  assert.equal(laidOut.style.writingMode, "vertical-rl");
});

test("layoutRegions reduces font size for long translated text", () => {
  const short = layoutRegions([region({ translatedText: "短句" })])[0]!;
  const long = layoutRegions([region({ translatedText: "这是一段非常非常长的译文，需要缩小字号避免溢出气泡" })])[0]!;
  assert.equal(long.style.fontSize < short.style.fontSize, true);
  assert.equal(long.style.fontSize >= 11, true);
});


