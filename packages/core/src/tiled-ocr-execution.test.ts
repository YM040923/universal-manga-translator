import test from "node:test";
import assert from "node:assert/strict";
import type { RecognitionUnit } from "@umt/shared";
import { OcrTranslatePipeline, type CorePreCroppedOcrInput, type CorePreCroppedOcrInputLoader } from "./pipeline.js";

test("OcrTranslatePipeline wraps tile OCR failures with safe tile context and a sanitized cause", async () => {
  const providerError = new Error("provider timeout https://signed.example/image?token=secret data:image/png;base64,secret");
  let ocrCalls = 0;
  let translatorCalls = 0;
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: {
      recognize: async () => {
        ocrCalls += 1;
        if (ocrCalls === 2) throw providerError;
        return [];
      },
    },
    translator: {
      translate: async () => {
        translatorCalls += 1;
        return [];
      },
    },
  });

  await assert.rejects(
    pipeline.process({
      imageBytes: new Uint8Array([0]),
      imageHash: "parent-hash",
      width: 1000,
      height: 16000,
      targetLanguage: "zh-CN",
      sourceLanguage: "auto",
      preCroppedOcrInputs: Array.from({ length: 5 }, (_, index) => tileInput(index)),
    }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      const tileError = error as Error;
      assert.match(tileError.message, /^OCR tile 2\/5 \(x=0,y=3584,w=1000,h=4096\) failed: provider timeout/);
      assert.equal(tileError.message.includes("https://"), false);
      assert.equal(tileError.message.includes("token=secret"), false);
      assert.equal(tileError.message.includes("data:image"), false);
      assert.notEqual(tileError.cause, providerError);
      assert.equal(tileError.cause instanceof Error, true);
      const causeMessage = (tileError.cause as Error).message;
      assert.equal(causeMessage.includes("https://"), false);
      assert.equal(causeMessage.includes("token=secret"), false);
      assert.equal(causeMessage.includes("data:image"), false);
      return true;
    },
  );
  assert.equal(translatorCalls, 0);
});

test("OcrTranslatePipeline consumes one loaded tile at a time and translates after all tile bytes are released", async () => {
  let activeTileBytes = 0;
  let maxActiveTileBytes = 0;
  const releasedTiles: number[] = [];
  const ocrOrder: number[] = [];
  let translatorCalls = 0;
  const loader: CorePreCroppedOcrInputLoader = {
    tileCount: 5,
    forEach: async (consume) => {
      for (let index = 0; index < 5; index += 1) {
        assert.equal(activeTileBytes, 0, `tile ${index + 1} loaded before the previous tile was released`);
        activeTileBytes += 1;
        maxActiveTileBytes = Math.max(maxActiveTileBytes, activeTileBytes);
        const input = tileInput(index);
        await consume(input, index);
        activeTileBytes -= 1;
        releasedTiles.push(index + 1);
      }
    },
  };
  const pipeline = new OcrTranslatePipeline({
    profile: "network-ocr:image+openai-compatible:gpt",
    ocr: {
      recognize: async (input) => {
        assert.equal(activeTileBytes, 1);
        assert.deepEqual(releasedTiles, Array.from({ length: ocrOrder.length }, (_, index) => index + 1));
        const tile = input as CorePreCroppedOcrInput;
        ocrOrder.push(tile.imageBytes[0]!);
        return [];
      },
    },
    translator: {
      translate: async () => {
        translatorCalls += 1;
        assert.equal(activeTileBytes, 0);
        assert.deepEqual(releasedTiles, [1, 2, 3, 4, 5]);
        return [];
      },
    },
  });

  await pipeline.process({
    imageBytes: new Uint8Array([0]),
    imageHash: "parent-hash",
    width: 1000,
    height: 16000,
    targetLanguage: "zh-CN",
    sourceLanguage: "auto",
    preCroppedOcrInputLoader: loader,
  });

  assert.equal(maxActiveTileBytes, 1);
  assert.deepEqual(ocrOrder, [1, 2, 3, 4, 5]);
  assert.equal(translatorCalls, 1);
});

function tileInput(index: number): CorePreCroppedOcrInput {
  const y = index * 3584;
  const height = Math.min(4096, 16000 - y);
  return {
    imageBytes: new Uint8Array([index + 1]),
    mimeType: "image/png",
    recognitionUnit: unit(`tile-${index + 1}`, y, height),
  };
}

function unit(id: string, y: number, height: number): RecognitionUnit {
  return {
    id,
    parentSurfaceId: "surface",
    crop: { x: 0, y, width: 1000, height },
    naturalSize: { width: 1000, height: 16000 },
    pixelSize: { width: 1000, height },
    scaleX: 1,
    scaleY: 1,
    priority: y === 0 ? "p0" : "p1",
    reason: "automatic",
    preprocessingVersion: "lossless-png-tile-v1",
  };
}
