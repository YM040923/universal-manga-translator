import test from "node:test";
import assert from "node:assert/strict";
import { OcrThenTranslateProvider } from "./pipeline-provider.js";
import type { ProviderInput } from "./provider.js";

const input: ProviderInput = {
  task: {
    surfaceId: "s1",
    pageUrl: "https://example.test",
    domain: "example.test",
    imageData: "data:image/png;base64,a",
    viewportPriority: "p0",
    surfaceRect: { x: 0, y: 0, width: 100, height: 100 },
    naturalSize: { width: 100, height: 100 },
    renderSize: { width: 100, height: 100 },
    readingDirection: "auto",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
  },
  imageBuffer: Buffer.from("image"),
  imageHash: "hash",
  width: 100,
  height: 100,
};

test("OcrThenTranslateProvider combines OCR regions with translated text", async () => {
  const provider = new OcrThenTranslateProvider({
    profile: "ocr-then-translate:test",
    ocr: {
      async recognize() {
        return [{ id: "r1", box: { x: 1, y: 2, width: 30, height: 40 }, sourceText: "こんにちは", confidence: 0.9, orientation: "horizontal", kind: "dialogue" }];
      },
    },
    translator: {
      async translate(items: Array<{ id: string; text: string }>, targetLanguage: string) {
        assert.equal(targetLanguage, "zh-CN");
        assert.deepEqual(items, [{ id: "r1", text: "こんにちは" }]);
        return [{ id: "r1", translatedText: "你好" }];
      },
    },
  });

  const regions = await provider.process(input);

  assert.deepEqual(regions, [{ id: "r1", box: { x: 1, y: 2, width: 30, height: 40 }, sourceText: "こんにちは", translatedText: "你好", confidence: 0.9, orientation: "horizontal", kind: "dialogue" }]);
});

