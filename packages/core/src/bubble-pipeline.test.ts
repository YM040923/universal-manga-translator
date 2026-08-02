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

test("overlap tiles canonicalize one ellipse and keep one stable translator item when duplicate confidence changes", async () => {
  const first = await runCrossTileBubble(0.96, 0.81);
  const second = await runCrossTileBubble(0.78, 0.97);

  assert.equal(first.itemCount, 1);
  assert.equal(second.itemCount, 1);
  assert.equal(first.regionCount, 1);
  assert.equal(second.regionCount, 1);
  assert.equal(first.id, second.id);
  assert.match(first.id, /^bubble-[a-f0-9]{8}$/);
});

async function runCrossTileBubble(
  firstDuplicateConfidence: number,
  secondDuplicateConfidence: number,
): Promise<{ itemCount: number; regionCount: number; id: string }> {
  let ocrCalls = 0;
  let translatedItems: TextTranslationItem[] = [];
  const pipeline = new OcrTranslatePipeline({
    profile: "cross-tile-bubble",
    ocr: {
      recognize: async () => {
        ocrCalls += 1;
        return ocrCalls === 1
          ? [regionWithConfidence("duplicate-a", "SAME LINE", 70, 760, firstDuplicateConfidence)]
          : [
            regionWithConfidence("duplicate-b", " SAME   LINE ", 71, 160, secondDuplicateConfidence),
            regionWithConfidence("second-line", "NEXT LINE", 68, 202, 0.93),
          ];
      },
    },
    translator: {
      translate: async (items) => {
        translatedItems = items;
        return items.map((item) => ({ id: item.id, translatedText: item.text }));
      },
    },
  });

  const result = await pipeline.process({
    imageBytes: new Uint8Array([0]),
    imageHash: "cross-tile-hash",
    width: 400,
    height: 1400,
    targetLanguage: "zh-CN",
    sourceLanguage: "auto",
    preCroppedOcrInputs: [
      {
        imageBytes: new Uint8Array([1]),
        mimeType: "image/png",
        recognitionUnit: overlapUnit("overlap-top", 0),
      },
      {
        imageBytes: new Uint8Array([2]),
        mimeType: "image/png",
        recognitionUnit: overlapUnit("overlap-bottom", 600),
      },
    ],
    bubbleEvidenceExtractor: async ({ observations, recognitionUnit }) => observations.map((observation) => ({
      observationId: observation.id,
      visualGroupId: recognitionUnit.id === "overlap-top" ? "local-top-component" : "local-bottom-component",
      componentBox: recognitionUnit.id === "overlap-top"
        ? { x: 40, y: 700, width: 230, height: 180 }
        : { x: 41, y: 101, width: 229, height: 179 },
      shape: "ellipse",
      confidence: recognitionUnit.id === "overlap-top" ? 0.9 : 0.95,
      touchesBoundary: false,
    })),
  });

  return {
    itemCount: translatedItems.length,
    regionCount: result.regions.length,
    id: result.regions[0]?.id ?? "",
  };
}

function overlapUnit(id: string, cropY: number) {
  return {
    id,
    parentSurfaceId: "surface:cross-tile",
    crop: { x: 0, y: cropY, width: 400, height: 800 },
    naturalSize: { width: 400, height: 1400 },
    pixelSize: { width: 400, height: 800 },
    scaleX: 1,
    scaleY: 1,
    priority: "p0" as const,
    reason: "automatic" as const,
    preprocessingVersion: "tile-v1",
  };
}

function region(id: string, sourceText: string, x: number, y: number): GenericOcrRegion {
  return regionWithConfidence(id, sourceText, x, y, 0.9);
}

function regionWithConfidence(
  id: string,
  sourceText: string,
  x: number,
  y: number,
  confidence: number,
): GenericOcrRegion {
  return {
    id,
    sourceText,
    box: { x, y, width: 80, height: 24 },
    confidence,
    orientation: "horizontal",
    kind: "dialogue",
  };
}
