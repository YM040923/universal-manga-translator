import test from "node:test";
import assert from "node:assert/strict";
import { OcrTranslatePipeline, buildOcrCacheKey, groupOcrRegionsIntoTextBlocks, type CoreOcrCache, type CoreOcrProvider, type CoreTextTranslator, type GenericOcrRegion, type TextTranslationItem, type TextTranslationOptions } from "./pipeline.js";

function region(id: string, text: string, x: number, y: number, width = 80, height = 24, confidence = 0.9): GenericOcrRegion {
  return { id, sourceText: text, box: { x, y, width, height }, confidence, orientation: "horizontal", kind: "dialogue" };
}

test("OcrTranslatePipeline combines OCR regions with translated text", async () => {
  const ocr: CoreOcrProvider = { recognize: async () => [region("r1", "Hello", 10, 20)] };
  const translator: CoreTextTranslator = { translate: async (items: TextTranslationItem[]) => items.map((item) => ({ id: item.id, translatedText: "你好" })) };
  const pipeline = new OcrTranslatePipeline({ profile: "network-ocr:image+openai-compatible:gpt", ocr, translator });

  const result = await pipeline.process({ imageBytes: new Uint8Array([1]), imageHash: "hash", width: 100, height: 100, targetLanguage: "zh-CN", sourceLanguage: "auto" });

  assert.equal(result.regions[0]?.translatedText, "你好");
  assert.equal(result.regions[0]?.sourceText, "Hello");
});

test("groupOcrRegionsIntoTextBlocks merges nearby OCR lines", () => {
  const blocks = groupOcrRegionsIntoTextBlocks([region("r1", "HELLO", 10, 20), region("r2", "THERE", 12, 50)]);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.sourceText, "HELLO\nTHERE");
});

test("groupOcrRegionsIntoTextBlocks dedupes overlapping OCR fragments", () => {
  const blocks = groupOcrRegionsIntoTextBlocks([
    region("low", "HELLO", 10, 20, 80, 24, 0.5),
    region("high", "HELLO", 11, 21, 80, 24, 0.95),
  ]);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.id, "high");
});

test("OcrTranslatePipeline does not cache empty OCR results", async () => {
  let saves = 0;
  const cache: CoreOcrCache = { get: async () => null, set: async () => { saves += 1; } };
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: { recognize: async () => [] },
    translator: { translate: async () => [] },
    ocrCache: cache,
  });

  await pipeline.process({ imageBytes: new Uint8Array([1]), imageHash: "hash", width: 100, height: 100, targetLanguage: "zh-CN", sourceLanguage: "auto" });

  assert.equal(saves, 0);
  assert.equal(pipeline.lastOcrCacheStatus, "miss");
});

test("OcrTranslatePipeline can reuse cached OCR regions during retranslate", async () => {
  let ocrCalls = 0;
  const cached = [region("r1", "Hello", 10, 20)];
  const cache: CoreOcrCache = { get: async () => cached, set: async () => undefined };
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: { recognize: async () => { ocrCalls += 1; return []; } },
    translator: { translate: async (_items: TextTranslationItem[], _target: string, _source: string, options?: TextTranslationOptions) => [{ id: "r1", translatedText: options?.retranslate ? "重新翻译" : "你好" }] },
    ocrCache: cache,
  });

  const result = await pipeline.process({ imageBytes: new Uint8Array([1]), imageHash: "hash", width: 100, height: 100, targetLanguage: "zh-CN", sourceLanguage: "auto", retranslate: true });

  assert.equal(ocrCalls, 0);
  assert.equal(pipeline.lastOcrCacheStatus, "hit");
  assert.equal(result.regions[0]?.translatedText, "重新翻译");
});

test("buildOcrCacheKey ignores downstream translator model changes", () => {
  const input = { imageHash: "hash", width: 100, height: 200, sourceLanguage: "en" };
  assert.equal(buildOcrCacheKey("network-ocr:image+openai-compatible:gpt-a", input), buildOcrCacheKey("network-ocr:image+openai-compatible:gpt-b", input));
});
