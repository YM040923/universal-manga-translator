import test from "node:test";
import assert from "node:assert/strict";
import { OcrTranslatePipeline, buildOcrCacheKey, groupOcrRegionsIntoTextBlocks, type CoreOcrCache, type CoreOcrProvider, type CoreTextTranslator, type GenericOcrRegion, type TextTranslationItem, type TextTranslationOptions } from "./pipeline.js";
import type { RecognitionUnit } from "@umt/shared";

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

test("OcrTranslatePipeline sends reading-order page context to the translator", async () => {
  let seenItems: TextTranslationItem[] = [];
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: {
      recognize: async () => [
        region("r1", "Where is Clark?", 10, 20, 160, 30),
        region("r2", "He went to the tower.", 12, 160, 180, 30),
      ],
    },
    translator: {
      translate: async (items: TextTranslationItem[]) => {
        seenItems = items;
        return items.map((item) => ({ id: item.id, translatedText: item.text }));
      },
    },
  });

  await pipeline.process({ imageBytes: new Uint8Array([1]), imageHash: "hash", width: 300, height: 500, targetLanguage: "zh-CN", sourceLanguage: "auto" });

  assert.equal(seenItems.length, 2);
  assert.match(seenItems[0]?.context ?? "", /order 1\/2/);
  assert.match(seenItems[0]?.context ?? "", /next: He went to the tower\./);
  assert.match(seenItems[1]?.context ?? "", /previous: Where is Clark\?/);
  assert.match(seenItems[1]?.context ?? "", /kind: dialogue/);
  assert.match(seenItems[1]?.context ?? "", /box:/);
});

test("OcrTranslatePipeline passes glossary terms to translator options", async () => {
  let seenOptions: TextTranslationOptions | undefined;
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: { recognize: async () => [region("r1", "Murim Lord Clark", 10, 20, 180, 30)] },
    translator: {
      translate: async (items: TextTranslationItem[], _target, _source, options?: TextTranslationOptions) => {
        seenOptions = options;
        return items.map((item) => ({ id: item.id, translatedText: item.text }));
      },
    },
  });

  await pipeline.process({
    imageBytes: new Uint8Array([1]),
    imageHash: "hash",
    width: 300,
    height: 500,
    targetLanguage: "zh-CN",
    sourceLanguage: "auto",
    glossary: { Murim: "武林", Clark: "克拉克" },
  });

  assert.deepEqual(seenOptions?.glossary, { Murim: "武林", Clark: "克拉克" });
});

test("buildOcrCacheKey ignores downstream translator model changes", () => {
  const input = { imageHash: "hash", width: 100, height: 200, sourceLanguage: "en" };
  assert.equal(buildOcrCacheKey("network-ocr:image+openai-compatible:gpt-a", input), buildOcrCacheKey("network-ocr:image+openai-compatible:gpt-b", input));
});

// RED: concurrent pipelines should share one OCR read for the same cache key.
test("OcrTranslatePipeline coalesces concurrent OCR misses for the same image", async () => {
  let ocrCalls = 0;
  let releaseOcr!: () => void;
  const gate = new Promise<void>((resolve) => { releaseOcr = resolve; });
  const stored = new Map<string, GenericOcrRegion[]>();
  const cache: CoreOcrCache = {
    get: async (key) => stored.get(key) ?? null,
    set: async (key, regions) => { stored.set(key, regions); },
  };
  const ocr: CoreOcrProvider = {
    recognize: async () => {
      ocrCalls += 1;
      await gate;
      return [region("r1", "HELLO", 10, 20)];
    },
  };
  const translator: CoreTextTranslator = {
    translate: async (items) => items.map((item) => ({ id: item.id, translatedText: "���" })),
  };
  const first = new OcrTranslatePipeline({ profile: "network-ocr:image+openai-compatible:gpt", ocr, translator, ocrCache: cache });
  const second = new OcrTranslatePipeline({ profile: "network-ocr:image+openai-compatible:gpt", ocr, translator, ocrCache: cache });
  const input = { imageBytes: new Uint8Array([1, 2, 3]), imageHash: "same", width: 100, height: 100, targetLanguage: "zh-CN", sourceLanguage: "auto" };

  const firstRun = first.process(input);
  const secondRun = second.process(input);
  await Promise.resolve();
  releaseOcr();
  await Promise.all([firstRun, secondRun]);

  assert.equal(ocrCalls, 1);
  assert.equal(first.lastOcrCacheStatus, "miss");
  assert.equal(second.lastOcrCacheStatus, "coalesced");
});

test("OcrTranslatePipeline forwards chapter context and previous translations", async () => {
  let optionsSeen: TextTranslationOptions | undefined;
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: { recognize: async () => [region("r1", "Hello", 10, 20)] },
    translator: {
      translate: async (items, _target, _source, options) => {
        optionsSeen = options;
        return items.map((item) => ({ id: item.id, translatedText: "���" }));
      },
    },
  });

  await pipeline.process({
    imageBytes: new Uint8Array([1]),
    imageHash: "h-context",
    width: 100,
    height: 100,
    targetLanguage: "zh-CN",
    sourceLanguage: "auto",
    chapterContext: "Earlier: protagonist is angry.",
    previousTranslations: [{ id: "old", translatedText: "֮ǰ����" }],
  });

  assert.equal(optionsSeen?.chapterContext, "Earlier: protagonist is angry.");
  assert.deepEqual(optionsSeen?.previousTranslations, [{ id: "old", translatedText: "֮ǰ����" }]);
});

test("buildOcrCacheKey ignores text style and glossary cache versions", () => {
  const input = { imageHash: "same-image", width: 100, height: 200, sourceLanguage: "auto" };

  assert.equal(
    buildOcrCacheKey("direct:image_base64+openai-compatible:gpt-a+style:manga-v1+glossary:a", input),
    buildOcrCacheKey("direct:image_base64+openai-compatible:gpt-b+style:manga-v9+glossary:b", input),
  );
});

test("OcrTranslatePipeline auto-detects repeated proper-name term candidates", async () => {
  let seenOptions: TextTranslationOptions | undefined;
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: { recognize: async () => [
      region("r1", "Clark met Heavenly Demon", 10, 20, 180, 20),
      region("r2", "Clark drew Moon Blade", 10, 60, 180, 20),
    ] },
    translator: {
      translate: async (items, _target, _source, options) => {
        seenOptions = options;
        return items.map((item) => ({ id: item.id, translatedText: item.text }));
      },
    },
  });

  await pipeline.process({ imageBytes: new Uint8Array([1]), imageHash: "terms", width: 300, height: 300, targetLanguage: "zh-CN", sourceLanguage: "auto" });

  assert.ok(seenOptions?.termCandidates?.includes("Clark"));
  assert.ok(seenOptions?.termCandidates?.includes("Heavenly Demon"));
  assert.ok(seenOptions?.termCandidates?.includes("Moon Blade"));
});


test("OcrTranslatePipeline remaps tile-local OCR boxes into parent natural coordinates", async () => {
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: { recognize: async () => [region("local", "HELLO", 20, 40, 200, 80)] },
    translator: { translate: async (items) => items.map((item) => ({ id: item.id, translatedText: item.text })) },
  });

  const result = await pipeline.process({
    imageBytes: new Uint8Array([0]),
    imageHash: "parent-hash",
    width: 1000,
    height: 3000,
    targetLanguage: "zh-CN",
    sourceLanguage: "auto",
    preCroppedOcrInputs: [{
      imageBytes: new Uint8Array([1]),
      mimeType: "image/png",
      recognitionUnit: recognitionUnit("tile-1", { x: 100, y: 1000, width: 500, height: 1000 }, 2),
    }],
  });

  assert.deepEqual(result.regions[0]?.box, { x: 110, y: 1020, width: 100, height: 40 });
});

test("OcrTranslatePipeline dedupes overlap observations and translates the whole page once", async () => {
  let ocrCalls = 0;
  let translatorCalls = 0;
  let translatedItems = 0;
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: {
      recognize: async () => {
        ocrCalls += 1;
        return ocrCalls === 1
          ? [region("same-a", "SAME TEXT", 20, 900, 120, 30, 0.8)]
          : [region("same-b", "SAME   TEXT", 20, 100, 120, 30, 0.95)];
      },
    },
    translator: {
      translate: async (items) => {
        translatorCalls += 1;
        translatedItems = items.length;
        return items.map((item) => ({ id: item.id, translatedText: item.text }));
      },
    },
  });

  await pipeline.process({
    imageBytes: new Uint8Array([0]),
    imageHash: "parent-hash",
    width: 1000,
    height: 2000,
    targetLanguage: "zh-CN",
    sourceLanguage: "auto",
    preCroppedOcrInputs: [
      {
        imageBytes: new Uint8Array([1]),
        recognitionUnit: recognitionUnit("tile-1", { x: 0, y: 0, width: 1000, height: 1000 }),
      },
      {
        imageBytes: new Uint8Array([2]),
        recognitionUnit: recognitionUnit("tile-2", { x: 0, y: 800, width: 1000, height: 1000 }),
      },
    ],
  });

  assert.equal(ocrCalls, 2);
  assert.equal(translatorCalls, 1);
  assert.equal(translatedItems, 1);
});

test("buildOcrCacheKey isolates crops and preprocessing while preserving full-image v1 semantics", () => {
  const fullInput = { imageHash: "same-image", width: 1000, height: 16000, sourceLanguage: "auto" };
  const oldKey = JSON.stringify({
    v: 1,
    ocrProfile: "direct:image_base64:ocr:abc",
    imageHash: "same-image",
    width: 1000,
    height: 16000,
    sourceLanguage: "auto",
  });
  assert.equal(buildOcrCacheKey("direct:image_base64:ocr:abc+openai-compatible:gpt", fullInput), oldKey);

  const first = buildOcrCacheKey("direct:image_base64:ocr:abc+openai-compatible:gpt", {
    ...fullInput,
    recognitionUnit: recognitionUnit("tile-1", { x: 0, y: 0, width: 1000, height: 4096 }),
  });
  const second = buildOcrCacheKey("direct:image_base64:ocr:abc+openai-compatible:gpt", {
    ...fullInput,
    recognitionUnit: recognitionUnit("tile-2", { x: 0, y: 3584, width: 1000, height: 4096 }),
  });
  const preprocessed = buildOcrCacheKey("direct:image_base64:ocr:abc+openai-compatible:gpt", {
    ...fullInput,
    recognitionUnit: { ...recognitionUnit("tile-1b", { x: 0, y: 0, width: 1000, height: 4096 }), preprocessingVersion: "png-tile-v2" },
  });

  assert.notEqual(first, second);
  assert.notEqual(first, preprocessed);
});

test("OcrTranslatePipeline coalesces concurrent cache misses for the same tile", async () => {
  let ocrCalls = 0;
  let releaseOcr!: () => void;
  const gate = new Promise<void>((resolve) => { releaseOcr = resolve; });
  const stored = new Map<string, GenericOcrRegion[]>();
  const cache: CoreOcrCache = {
    get: async (key) => stored.get(key) ?? null,
    set: async (key, regions) => { stored.set(key, regions); },
  };
  const ocr: CoreOcrProvider = {
    recognize: async () => {
      ocrCalls += 1;
      await gate;
      return [region("r1", "HELLO", 10, 20)];
    },
  };
  const translator: CoreTextTranslator = {
    translate: async (items) => items.map((item) => ({ id: item.id, translatedText: item.text })),
  };
  const first = new OcrTranslatePipeline({ profile: "network-ocr:image+openai-compatible:gpt", ocr, translator, ocrCache: cache });
  const second = new OcrTranslatePipeline({ profile: "network-ocr:image+openai-compatible:gpt", ocr, translator, ocrCache: cache });
  const input = {
    imageBytes: new Uint8Array([0]),
    imageHash: "same-parent",
    width: 1000,
    height: 16000,
    targetLanguage: "zh-CN",
    sourceLanguage: "auto",
    preCroppedOcrInputs: [{
      imageBytes: new Uint8Array([1]),
      recognitionUnit: recognitionUnit("same-tile", { x: 0, y: 0, width: 1000, height: 4096 }),
    }],
  };

  const firstRun = first.process(input);
  const secondRun = second.process(input);
  await Promise.resolve();
  releaseOcr();
  await Promise.all([firstRun, secondRun]);

  assert.equal(ocrCalls, 1);
});

function recognitionUnit(id: string, crop: RecognitionUnit["crop"], scale = 1): RecognitionUnit {
  return {
    id,
    parentSurfaceId: "surface:tall",
    crop,
    naturalSize: { width: 1000, height: 16000 },
    pixelSize: { width: crop.width * scale, height: crop.height * scale },
    scaleX: scale,
    scaleY: scale,
    priority: id.endsWith("1") ? "p0" : "p1",
    reason: "automatic",
    preprocessingVersion: "png-tile-v1",
  };
}
