import test from "node:test";
import assert from "node:assert/strict";
import type { RecognitionUnit } from "@umt/shared";
import {
  OcrTranslatePipeline,
  applyOcrPreprocessVariantToUnit,
  type CoreOcrPreprocessLoader,
  type CoreOcrProvider,
  type CoreOcrRescueDiagnostic,
  type CorePipelineInput,
  type GenericOcrRegion,
  type OcrPreprocessVariant,
} from "./index.js";

test("OcrTranslatePipeline does not rescue normal OCR", async () => {
  let ocrCalls = 0;
  let rescueLoads = 0;
  const pipeline = pipelineWith(async () => {
    ocrCalls += 1;
    return [region("normal", "This is normal dialogue.", 0.94)];
  });

  const result = await pipeline.process(input({
    ocrPreprocessLoader: loader(() => { rescueLoads += 1; }),
    maxOcrRescueCallsPerImage: 1,
  }));

  assert.equal(ocrCalls, 1);
  assert.equal(rescueLoads, 0);
  assert.equal(result.regions[0]?.sourceText, "This is normal dialogue.");
});

test("OcrTranslatePipeline rescues low confidence OCR, selects the better result, and translates once", async () => {
  let ocrCalls = 0;
  let translatorCalls = 0;
  const variants: string[] = [];
  const diagnostics: CoreOcrRescueDiagnostic[] = [];
  const pipeline = pipelineWith(async () => {
    ocrCalls += 1;
    return ocrCalls === 1
      ? [region("low", "H3LL?", 0.22)]
      : [region("better", "HELLO", 0.96)];
  }, () => { translatorCalls += 1; });

  const result = await pipeline.process(input({
    ocrPreprocessLoader: loader((variant) => { variants.push(variant.id); }),
    maxOcrRescueCallsPerImage: 1,
    onOcrRescueDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  }));

  assert.equal(ocrCalls, 2);
  assert.deepEqual(variants, ["grayscale-contrast"]);
  assert.equal(result.regions[0]?.sourceText, "HELLO");
  assert.equal(translatorCalls, 1);
  assert.equal(diagnostics[0]?.selected, "rescue");
  assert.equal(diagnostics[0]?.usedBudget, 1);
  assert.equal(diagnostics[0]?.remainingBudget, 0);
  assert.equal(diagnostics[0]?.reasons.includes("low-confidence"), true);
  const safeDiagnostic = JSON.stringify(diagnostics);
  assert.equal(safeDiagnostic.includes("H3LL?"), false);
  assert.equal(safeDiagnostic.includes("HELLO"), false);
});

test("OcrTranslatePipeline keeps the original OCR when rescue quality is worse", async () => {
  let ocrCalls = 0;
  const pipeline = pipelineWith(async () => {
    ocrCalls += 1;
    return ocrCalls === 1
      ? [region("original", "HERO", 0.5)]
      : [region("worse", "@?", 0.08)];
  });

  const result = await pipeline.process(input({
    ocrPreprocessLoader: loader(),
    maxOcrRescueCallsPerImage: 1,
  }));

  assert.equal(ocrCalls, 2);
  assert.equal(result.regions[0]?.sourceText, "HERO");
});

test("OcrTranslatePipeline does not rescue empty OCR without evidence", async () => {
  let ocrCalls = 0;
  let rescueLoads = 0;
  const pipeline = pipelineWith(async () => {
    ocrCalls += 1;
    return [];
  });

  await pipeline.process(input({
    ocrPreprocessLoader: loader(() => { rescueLoads += 1; }),
    maxOcrRescueCallsPerImage: 1,
  }));

  assert.equal(ocrCalls, 1);
  assert.equal(rescueLoads, 0);
});

test("OcrTranslatePipeline rescues empty manual selections and likely-text inputs", async () => {
  for (const evidence of ["manual", "likely"] as const) {
    let ocrCalls = 0;
    const pipeline = pipelineWith(async () => {
      ocrCalls += 1;
      return ocrCalls === 1 ? [] : [region("rescued", "FOUND", 0.92)];
    });
    const recognitionUnit = unit(evidence === "manual" ? "manual-selection" : "automatic");

    const result = await pipeline.process(input({
      recognitionUnit,
      likelyTextEvidence: evidence === "likely",
      ocrPreprocessLoader: loader(),
      maxOcrRescueCallsPerImage: 1,
    }));

    assert.equal(ocrCalls, 2, evidence);
    assert.equal(result.regions[0]?.sourceText, "FOUND", evidence);
  }
});

test("OcrTranslatePipeline preserves provider errors without image rescue", async () => {
  for (const message of [
    "Network OCR failed: 402 quota exhausted",
    "Network OCR failed: 401 unauthorized",
    "Network OCR failed: 403 permission denied",
    "Network OCR failed: 429 rate limit reached",
    "fetch failed: network timeout",
    "Network OCR failed: 503 provider unavailable",
  ]) {
    const original = new Error(message);
    let rescueLoads = 0;
    const pipeline = pipelineWith(async () => { throw original; });
    let caught: unknown;

    try {
      await pipeline.process(input({
        ocrPreprocessLoader: loader(() => { rescueLoads += 1; }),
        maxOcrRescueCallsPerImage: 3,
      }));
    } catch (error) {
      caught = error;
    }

    assert.equal(caught, original, message);
    assert.equal(rescueLoads, 0, message);
  }
});

test("OcrTranslatePipeline propagates rescue-stage provider errors with safe context and skips translation", async () => {
  for (const message of [
    "Network OCR failed: 401 unauthorized",
    "Network OCR failed: 402 quota exhausted",
    "Network OCR failed: 429 rate limit reached",
    "fetch failed: network timeout",
    "Network OCR failed: 500 provider unavailable",
  ]) {
    let ocrCalls = 0;
    let translatorCalls = 0;
    const rescueError = new Error(message);
    const pipeline = pipelineWith(async () => {
      ocrCalls += 1;
      if (ocrCalls === 1) return [region("low", "H3LL?", 0.2)];
      throw rescueError;
    }, () => { translatorCalls += 1; });
    let caught: unknown;

    try {
      await pipeline.process(input({
        ocrPreprocessLoader: loader(),
        maxOcrRescueCallsPerImage: 1,
      }));
    } catch (error) {
      caught = error;
    }

    assert.equal(caught instanceof Error, true, message);
    assert.match((caught as Error).message, /^OCR rescue \(grayscale-contrast, unit x=0,y=0,w=1000,h=1000\) failed:/, message);
    assert.equal((caught as Error).cause, rescueError, message);
    assert.equal(translatorCalls, 0, message);
  }
});

test("OcrTranslatePipeline disables rescue completely when the per-image budget is zero", async () => {
  let ocrCalls = 0;
  let rescueLoads = 0;
  const pipeline = pipelineWith(async () => {
    ocrCalls += 1;
    return [region("low", "H3LL?", 0.2)];
  });

  const result = await pipeline.process(input({
    ocrPreprocessLoader: loader(() => { rescueLoads += 1; }),
    maxOcrRescueCallsPerImage: 0,
  }));

  assert.equal(ocrCalls, 1);
  assert.equal(rescueLoads, 0);
  assert.equal(result.regions[0]?.sourceText, "H3LL?");
});

test("OcrTranslatePipeline defaults to one rescue call when the budget is omitted", async () => {
  let ocrCalls = 0;
  const pipeline = pipelineWith(async () => {
    ocrCalls += 1;
    return ocrCalls === 1
      ? [region("low", "H3LL?", 0.2)]
      : [region("better", "HELLO", 0.96)];
  });

  const result = await pipeline.process(input({
    ocrPreprocessLoader: loader(),
  }));

  assert.equal(ocrCalls, 2);
  assert.equal(result.regions[0]?.sourceText, "HELLO");
});

test("OcrTranslatePipeline spends rescue budget across the whole tiled image", async () => {
  let ocrCalls = 0;
  let rescueLoads = 0;
  let translatorCalls = 0;
  const pipeline = pipelineWith(async () => {
    ocrCalls += 1;
    if (ocrCalls === 1) return [region("tile-1-low", "A?", 0.2)];
    if (ocrCalls === 2) return [region("tile-1-better", "ALPHA", 0.95)];
    return [region("tile-2-low", "B?", 0.2)];
  }, () => { translatorCalls += 1; });
  const first = unit("automatic", "tile-1", { x: 0, y: 0, width: 1000, height: 600 });
  const second = unit("automatic", "tile-2", { x: 0, y: 500, width: 1000, height: 500 });

  await pipeline.process(input({
    preCroppedOcrInputs: [
      { imageBytes: new Uint8Array([1]), recognitionUnit: first },
      { imageBytes: new Uint8Array([2]), recognitionUnit: second },
    ],
    ocrPreprocessLoader: loader(() => { rescueLoads += 1; }),
    maxOcrRescueCallsPerImage: 1,
  }));

  assert.equal(ocrCalls, 3);
  assert.equal(rescueLoads, 1);
  assert.equal(translatorCalls, 1);
});

test("OcrTranslatePipeline maps upscaled rescue boxes back through tile coordinates", async () => {
  let ocrCalls = 0;
  const pipeline = pipelineWith(async () => {
    ocrCalls += 1;
    if (ocrCalls === 1) {
      return [{
        ...region("small", "tiny text", 0.72),
        box: { x: 20, y: 10, width: 180, height: 12 },
      }];
    }
    return [{
      ...region("upscaled", "tiny text", 0.97),
      box: { x: 40, y: 20, width: 360, height: 24 },
    }];
  });
  const recognitionUnit = unit("automatic", "tile-small", { x: 100, y: 200, width: 500, height: 400 });

  const result = await pipeline.process(input({
    width: 1000,
    height: 1000,
    preCroppedOcrInputs: [{ imageBytes: new Uint8Array([1]), recognitionUnit }],
    ocrPreprocessLoader: loader(),
    maxOcrRescueCallsPerImage: 1,
  }));

  assert.equal(ocrCalls, 2);
  assert.deepEqual(result.regions[0]?.box, { x: 120, y: 210, width: 180, height: 12 });
});

function pipelineWith(
  recognize: CoreOcrProvider["recognize"],
  onTranslate: () => void = () => {},
): OcrTranslatePipeline {
  return new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: { recognize },
    translator: {
      translate: async (items) => {
        onTranslate();
        return items.map((item) => ({ id: item.id, translatedText: item.text }));
      },
    },
  });
}

function input(overrides: Partial<CorePipelineInput> = {}): CorePipelineInput {
  return {
    imageBytes: new Uint8Array([0]),
    imageHash: "image-hash",
    width: 1000,
    height: 1000,
    targetLanguage: "zh-CN",
    sourceLanguage: "auto",
    recognitionUnit: unit(),
    ...overrides,
  };
}

function loader(onVariant: (variant: OcrPreprocessVariant) => void = () => {}): CoreOcrPreprocessLoader {
  return {
    withVariant: async (source, variant, consume) => {
      onVariant(variant);
      return consume({
        imageBytes: new Uint8Array([9]),
        fileName: `${variant.id}.png`,
        mimeType: "image/png",
        recognitionUnit: applyOcrPreprocessVariantToUnit(source.recognitionUnit, variant),
        ocrVariant: variant.id,
      });
    },
  };
}

function unit(
  reason: RecognitionUnit["reason"] = "automatic",
  id = "full",
  crop: RecognitionUnit["crop"] = { x: 0, y: 0, width: 1000, height: 1000 },
): RecognitionUnit {
  return {
    id,
    parentSurfaceId: "surface-1",
    crop,
    naturalSize: { width: 1000, height: 1000 },
    pixelSize: { width: crop.width, height: crop.height },
    scaleX: 1,
    scaleY: 1,
    priority: "p0",
    reason,
    preprocessingVersion: "none-v1",
  };
}

function region(id: string, sourceText: string, confidence: number): GenericOcrRegion {
  return {
    id,
    sourceText,
    confidence,
    box: { x: 20, y: 20, width: 180, height: 32 },
    orientation: "horizontal",
    kind: "dialogue",
  };
}
