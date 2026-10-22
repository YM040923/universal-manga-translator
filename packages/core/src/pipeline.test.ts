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

test("groupOcrRegionsIntoTextBlocks respects RTL reading direction for same-row regions", () => {
  const blocks = groupOcrRegionsIntoTextBlocks(
    [
      { ...region("r1", "右", 600, 20), kind: "sfx" as const },
      { ...region("r2", "中", 300, 20), kind: "sfx" as const },
      { ...region("r3", "左", 10, 20), kind: "sfx" as const },
    ],
    "rtl",
  );

  assert.equal(blocks.length, 3);
  assert.equal(blocks[0]?.sourceText, "右");
  assert.equal(blocks[1]?.sourceText, "中");
  assert.equal(blocks[2]?.sourceText, "左");
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

test("OcrTranslatePipeline filters out low-confidence OCR regions", async () => {
  let translatedItems: TextTranslationItem[] = [];
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: {
      recognize: async () => [
        region("r1", "Good text", 10, 20, 80, 24, 0.9),
        region("r2", "Bad text", 10, 200, 80, 24, 0.3),
        region("r3", "Borderline", 10, 380, 80, 24, 0.5),
      ],
    },
    translator: {
      translate: async (items) => {
        translatedItems = items;
        return items.map((item) => ({ id: item.id, translatedText: "译" }));
      },
    },
  });

  await pipeline.process({ imageBytes: new Uint8Array([1]), imageHash: "confidence-test", width: 100, height: 500, targetLanguage: "zh-CN", sourceLanguage: "auto" });

  assert.equal(translatedItems.length, 2);
  assert.ok(translatedItems.some((item) => item.text === "Good text"));
  assert.ok(translatedItems.some((item) => item.text === "Borderline"));
  assert.ok(!translatedItems.some((item) => item.text === "Bad text"));
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

test("OcrTranslatePipeline does not cache garbled OCR results", async () => {
  let saves = 0;
  const cache: CoreOcrCache = { get: async () => null, set: async () => { saves += 1; } };
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: { recognize: async () => [region("r1", "ãƒ†ã‚¹ãƒˆ", 10, 20)] },
    translator: { translate: async (items) => items.map((item) => ({ id: item.id, translatedText: item.text })) },
    ocrCache: cache,
  });

  await pipeline.process({ imageBytes: new Uint8Array([1]), imageHash: "garbled-write", width: 100, height: 100, targetLanguage: "zh-CN", sourceLanguage: "auto" });

  assert.equal(saves, 0);
});

test("OcrTranslatePipeline re-runs OCR when the cache holds garbled regions", async () => {
  let ocrCalls = 0;
  const input = { imageBytes: new Uint8Array([1]), imageHash: "garbled-read", width: 100, height: 100, targetLanguage: "zh-CN", sourceLanguage: "auto" };
  const staleKey = buildOcrCacheKey("network-ocr:image+openai-compatible:gpt", input);
  const stored = new Map<string, GenericOcrRegion[]>([[staleKey, [region("stale", "ãƒ†ã‚¹ãƒˆ", 10, 20)]]]);
  const cache: CoreOcrCache = {
    get: async (key) => stored.get(key) ?? null,
    set: async (key, regions) => { stored.set(key, regions); },
  };
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: { recognize: async () => { ocrCalls += 1; return [region("fresh", "Hello", 10, 20)]; } },
    translator: { translate: async (items) => items.map((item) => ({ id: item.id, translatedText: item.text })) },
    ocrCache: cache,
  });

  const result = await pipeline.process(input);

  assert.equal(ocrCalls, 1);
  assert.equal(pipeline.lastOcrCacheStatus, "miss");
  assert.equal(result.regions[0]?.sourceText, "Hello");
  assert.equal(stored.get(staleKey)?.[0]?.sourceText, "Hello");
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
    translate: async (items) => items.map((item) => ({ id: item.id, translatedText: "你好" })),
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
        return items.map((item) => ({ id: item.id, translatedText: "你好" }));
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
    previousTranslations: [{ id: "old", translatedText: "之前译文" }],
  });

  assert.equal(optionsSeen?.chapterContext, "Earlier: protagonist is angry.");
  assert.deepEqual(optionsSeen?.previousTranslations, [{ id: "old", translatedText: "之前译文" }]);
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

test("classifyRegionKind detects Japanese SFX (katakana onomatopoeia)", async () => {
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: { recognize: async () => [
      region("r1", "ドン！", 10, 20, 80, 80),
      region("r2", "バキッ", 100, 20, 60, 60),
      region("r3", "ゴゴゴ", 200, 20, 70, 70),
      region("r4", "Hello world", 10, 150, 180, 30),
    ] },
    translator: {
      translate: async (items) => items.map((item) => ({ id: item.id, translatedText: item.text })),
    },
  });

  const result = await pipeline.process({ imageBytes: new Uint8Array([1]), imageHash: "sfx-test", width: 300, height: 300, targetLanguage: "zh-CN", sourceLanguage: "auto" });

  assert.equal(result.regions[0]?.kind, "sfx");
  assert.equal(result.regions[1]?.kind, "sfx");
  assert.equal(result.regions[2]?.kind, "sfx");
  assert.equal(result.regions[3]?.kind, "dialogue");
});
