import test from "node:test";
import assert from "node:assert/strict";
import { OcrThenTranslateProvider } from "./pipeline-provider.js";
import { buildOcrCacheKey } from "./pipeline-provider.js";
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

test("OcrThenTranslateProvider groups nearby OCR lines into one dialogue block before translating", async () => {
  const provider = new OcrThenTranslateProvider({
    profile: "ocr-then-translate:test",
    ocr: {
      async recognize() {
        return [
          { id: "l1", box: { x: 100, y: 100, width: 420, height: 46 }, sourceText: "THE EVIL SMILING DEMON", confidence: 0.95, orientation: "horizontal", kind: "dialogue" },
          { id: "l2", box: { x: 110, y: 156, width: 400, height: 46 }, sourceText: "BECOMES OBSESSED WITH", confidence: 0.95, orientation: "horizontal", kind: "dialogue" },
          { id: "l3", box: { x: 150, y: 212, width: 330, height: 46 }, sourceText: "PEOPLE WHO PROVOKE", confidence: 0.95, orientation: "horizontal", kind: "dialogue" },
          { id: "l4", box: { x: 180, y: 268, width: 260, height: 46 }, sourceText: "AND INTEREST HIM.", confidence: 0.95, orientation: "horizontal", kind: "dialogue" },
        ];
      },
    },
    translator: {
      async translate(items: Array<{ id: string; text: string }>) {
        assert.deepEqual(items, [{
          id: "block-l1",
          text: "THE EVIL SMILING DEMON\nBECOMES OBSESSED WITH\nPEOPLE WHO PROVOKE\nAND INTEREST HIM.",
        }]);
        return [{ id: "block-l1", translatedText: "那个邪恶微笑的恶魔会对那些挑衅他、引起他兴趣的人着迷。" }];
      },
    },
  });

  const regions = await provider.process(input);

  assert.equal(regions.length, 1);
  assert.equal(regions[0]!.id, "block-l1");
  assert.deepEqual(regions[0]!.box, { x: 87, y: 89, width: 446, height: 236 });
  assert.equal(regions[0]!.sourceText, "THE EVIL SMILING DEMON\nBECOMES OBSESSED WITH\nPEOPLE WHO PROVOKE\nAND INTEREST HIM.");
  assert.equal(regions[0]!.translatedText, "那个邪恶微笑的恶魔会对那些挑衅他、引起他兴趣的人着迷。");
});

test("OcrThenTranslateProvider dedupes overlapping OCR fragments before translation", async () => {
  const provider = new OcrThenTranslateProvider({
    profile: "ocr-then-translate:test",
    ocr: {
      async recognize() {
        return [
          { id: "a", box: { x: 100, y: 100, width: 260, height: 42 }, sourceText: "GIVE ME", confidence: 0.95, orientation: "horizontal", kind: "dialogue" },
          { id: "a-dup", box: { x: 104, y: 102, width: 255, height: 40 }, sourceText: "GIVE ME", confidence: 0.8, orientation: "horizontal", kind: "dialogue" },
          { id: "b", box: { x: 118, y: 150, width: 220, height: 42 }, sourceText: "EVERYTHING!!", confidence: 0.95, orientation: "horizontal", kind: "dialogue" },
        ];
      },
    },
    translator: {
      async translate(items: Array<{ id: string; text: string }>) {
        assert.deepEqual(items, [{ id: "block-a", text: "GIVE ME\nEVERYTHING!!" }]);
        return [{ id: "block-a", translatedText: "全部都给我！！" }];
      },
    },
  });

  const regions = await provider.process(input);

  assert.equal(regions.length, 1);
  assert.equal(regions[0]!.sourceText, "GIVE ME\nEVERYTHING!!");
});

test("OcrThenTranslateProvider merges horizontally separated narration lines in one caption box", async () => {
  const provider = new OcrThenTranslateProvider({
    profile: "ocr-then-translate:test",
    ocr: {
      async recognize() {
        return [
          { id: "n1", box: { x: 100, y: 200, width: 120, height: 52 }, sourceText: "NO.", confidence: 0.9, orientation: "horizontal", kind: "narration" },
          { id: "n2", box: { x: 280, y: 205, width: 260, height: 52 }, sourceText: "EVERYONE WANTS", confidence: 0.9, orientation: "horizontal", kind: "narration" },
          { id: "n3", box: { x: 590, y: 204, width: 280, height: 52 }, sourceText: "A REASONABLE PLAN.", confidence: 0.9, orientation: "horizontal", kind: "narration" },
        ];
      },
    },
    translator: {
      async translate(items: Array<{ id: string; text: string }>) {
        assert.equal(items.length, 1);
        assert.equal(items[0]!.text, "NO.\nEVERYONE WANTS\nA REASONABLE PLAN.");
        return [{ id: items[0]!.id, translatedText: "没错。每个人都想出一个合理的计划。" }];
      },
    },
  });

  const regions = await provider.process(input);

  assert.equal(regions.length, 1);
});

test("OcrThenTranslateProvider merges same speech bubble lines even when OCR splits side fragments", async () => {
  const provider = new OcrThenTranslateProvider({
    profile: "ocr-then-translate:test",
    ocr: {
      async recognize() {
        return [
          { id: "a", box: { x: 450, y: 120, width: 260, height: 62 }, sourceText: "APPEARED IN", confidence: 0.95, orientation: "horizontal", kind: "dialogue" },
          { id: "b", box: { x: 480, y: 196, width: 190, height: 56 }, sourceText: "FLOWER STREET", confidence: 0.95, orientation: "horizontal", kind: "dialogue" },
          { id: "c", box: { x: 310, y: 280, width: 170, height: 52 }, sourceText: "BRING", confidence: 0.93, orientation: "horizontal", kind: "dialogue" },
          { id: "d", box: { x: 515, y: 282, width: 230, height: 52 }, sourceText: "A GROUP!!", confidence: 0.93, orientation: "horizontal", kind: "dialogue" },
        ];
      },
    },
    translator: {
      async translate(items: Array<{ id: string; text: string }>) {
        assert.equal(items.length, 1);
        assert.equal(items[0]!.text, "APPEARED IN\nFLOWER STREET\nBRING\nA GROUP!!");
        return [{ id: items[0]!.id, translatedText: "出现在花街，带了一群人！！" }];
      },
    },
  });

  const regions = await provider.process(input);

  assert.equal(regions.length, 1);
});


test("OcrThenTranslateProvider merges vertically separated centered narration lines in one caption panel", async () => {
  const provider = new OcrThenTranslateProvider({
    profile: "ocr-then-translate:test",
    ocr: {
      async recognize() {
        return [
          { id: "p1", box: { x: 315, y: 135, width: 170, height: 54 }, sourceText: "FIRST,", confidence: 0.95, orientation: "horizontal", kind: "narration" },
          { id: "p2", box: { x: 260, y: 220, width: 280, height: 58 }, sourceText: "THOSE BASTARDS", confidence: 0.95, orientation: "horizontal", kind: "narration" },
          { id: "p3", box: { x: 180, y: 310, width: 440, height: 58 }, sourceText: "USING SOUL ENERGY", confidence: 0.95, orientation: "horizontal", kind: "narration" },
          { id: "p4", box: { x: 295, y: 398, width: 210, height: 54 }, sourceText: "METHOD", confidence: 0.95, orientation: "horizontal", kind: "narration" },
          { id: "p5", box: { x: 250, y: 470, width: 300, height: 50 }, sourceText: "SOUL ENERGY.", confidence: 0.95, orientation: "horizontal", kind: "narration" },
        ];
      },
    },
    translator: {
      async translate(items) {
        assert.equal(items.length, 1);
        assert.equal(items[0]!.text, "FIRST,\nTHOSE BASTARDS\nUSING SOUL ENERGY\nMETHOD\nSOUL ENERGY.");
        return [{ id: items[0]!.id, translatedText: "首先，那些混蛋运用灵魂能量的方式。" }];
      },
    },
  });

  const regions = await provider.process({ ...input, width: 800, height: 900 });

  assert.equal(regions.length, 1);
  assert.equal(regions[0]!.kind, "narration");
});

test("OcrThenTranslateProvider classifies oversized action lettering as sfx instead of dialogue", async () => {
  const provider = new OcrThenTranslateProvider({
    profile: "ocr-then-translate:test",
    ocr: {
      async recognize() {
        return [
          { id: "sfx1", box: { x: 1, y: 1011, width: 354, height: 610 }, sourceText: "SUN\nGOD)\nFISTT", confidence: 0.92, orientation: "horizontal", kind: "dialogue" },
          { id: "sfx2", box: { x: 3, y: 1506, width: 531, height: 298 }, sourceText: "LPUL\nSTRIKE E", confidence: 0.9, orientation: "horizontal", kind: "dialogue" },
        ];
      },
    },
    translator: {
      async translate(items: Array<{ id: string; text: string }>) {
        assert.equal(items.length, 2);
        return items.map((item) => ({ id: item.id, translatedText: item.text }));
      },
    },
  });

  const regions = await provider.process({ ...input, width: 800, height: 7165 });

  assert.deepEqual(regions.map((region) => region.kind), ["sfx", "sfx"]);
});

test("OcrThenTranslateProvider reuses cached OCR regions during retranslate and reruns translator", async () => {
  const ocrCache = new Map<string, unknown>();
  let ocrCalls = 0;
  let translationCalls = 0;
  const provider = new OcrThenTranslateProvider({
    profile: "ocr-then-translate:test",
    ocrCache: {
      get: (key: string) => (ocrCache.get(key) as any) ?? null,
      save: (key: string, regions: any) => { ocrCache.set(key, regions); },
    },
    ocr: {
      async recognize() {
        ocrCalls += 1;
        return [{ id: "r1", box: { x: 1, y: 2, width: 30, height: 40 }, sourceText: "HELLO", confidence: 0.9, orientation: "horizontal", kind: "dialogue" }];
      },
    },
    translator: {
      async translate(items, _targetLanguage, _sourceLanguage, options) {
        translationCalls += 1;
        assert.deepEqual(items, [{ id: "r1", text: "HELLO" }]);
        return [{ id: "r1", translatedText: options?.retranslate ? "重翻" : "你好" }];
      },
    },
  });

  const first = await provider.process(input);
  const second = await provider.process({ ...input, forceRetranslate: true });

  assert.equal(ocrCalls, 1);
  assert.equal(translationCalls, 2);
  assert.equal(first[0]!.translatedText, "你好");
  assert.equal(second[0]!.translatedText, "重翻");
  assert.equal(provider.lastOcrCacheStatus, "hit");
});

test("buildOcrCacheKey ignores downstream translator model changes", () => {
  assert.equal(
    buildOcrCacheKey("uapis-ocr:image_base64+openai-compatible:gpt-5.4-mini", input),
    buildOcrCacheKey("uapis-ocr:image_base64+openai-compatible:gpt-5.5", input),
  );
});

test("OcrThenTranslateProvider does not cache empty OCR results", async () => {
  const saved: string[] = [];
  const provider = new OcrThenTranslateProvider({
    profile: "ocr-then-translate:test",
    ocrCache: {
      get: () => null,
      save: (key: string) => { saved.push(key); },
    },
    ocr: { async recognize() { return []; } },
    translator: { async translate() { return []; } },
  });

  const regions = await provider.process(input);

  assert.deepEqual(regions, []);
  assert.deepEqual(saved, []);
});

