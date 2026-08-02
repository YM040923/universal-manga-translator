import test from "node:test";
import assert from "node:assert/strict";
import {
  OcrTranslatePipeline,
  type CoreOcrCache,
  type GenericOcrRegion,
  type TextTranslationItem,
} from "./pipeline.js";

test("bubble evidence extraction failure safely falls back to conservative geometry", async () => {
  let translatedItems: TextTranslationItem[] = [];
  const pipeline = new OcrTranslatePipeline({
    profile: "bubble-fallback",
    ocr: { recognize: async () => [
      region("first", "FIRST", 20, 20),
      region("second", "SECOND", 180, 120),
    ] },
    translator: {
      translate: async (items) => {
        translatedItems = items;
        return items.map((item) => ({ id: item.id, translatedText: item.text }));
      },
    },
  });

  const result = await pipeline.process({
    imageBytes: new Uint8Array([1, 2, 3]),
    imageHash: "fallback-hash",
    width: 320,
    height: 240,
    targetLanguage: "zh-CN",
    sourceLanguage: "auto",
    bubbleEvidenceExtractor: async () => {
      throw new Error("canvas unavailable");
    },
  });

  assert.equal(translatedItems.length, 2);
  assert.equal(result.regions.length, 2);
});

test("bubble ownership evidence stays out of the OCR cache", async () => {
  const stored = new Map<string, GenericOcrRegion[]>();
  const cache: CoreOcrCache = {
    get: async (key) => stored.get(key) ?? null,
    set: async (key, regions) => { stored.set(key, regions); },
  };
  let ocrCalls = 0;
  const createPipeline = () => new OcrTranslatePipeline({
    profile: "bubble-cache",
    ocr: {
      recognize: async () => {
        ocrCalls += 1;
        return [
          region("line-1", "ONE", 40, 30),
          region("line-2", "TWO", 40, 115),
        ];
      },
    },
    translator: {
      translate: async (items) => items.map((item) => ({ id: item.id, translatedText: item.text })),
    },
    ocrCache: cache,
  });
  const input = {
    imageBytes: new Uint8Array([9]),
    imageHash: "cache-hash",
    width: 180,
    height: 180,
    targetLanguage: "zh-CN",
    sourceLanguage: "auto",
  };

  const first = await createPipeline().process({
    ...input,
    bubbleEvidenceExtractor: async ({ observations }) => observations.map((observation) => ({
      observationId: observation.id,
      visualGroupId: "one-bubble",
      componentBox: { x: 20, y: 10, width: 130, height: 150 },
      shape: "ellipse",
      confidence: 0.95,
      touchesBoundary: false,
    })),
  });
  const second = await createPipeline().process(input);

  assert.equal(first.regions.length, 1);
  assert.equal(second.regions.length, 2);
  assert.equal(ocrCalls, 1);
  assert.equal([...stored.values()][0]?.length, 2);
});

function region(id: string, sourceText: string, x: number, y: number): GenericOcrRegion {
  return {
    id,
    sourceText,
    box: { x, y, width: 80, height: 24 },
    confidence: 0.9,
    orientation: "horizontal",
    kind: "dialogue",
  };
}
