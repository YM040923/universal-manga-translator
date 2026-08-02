import test from "node:test";
import assert from "node:assert/strict";
import type { RecognitionUnit, Rect, Size } from "@umt/shared";
import { buildOcrCacheKey } from "./pipeline.js";

test("buildOcrCacheKey canonicalizes tile geometry independent of property insertion order", () => {
  const cropA = { x: 10, y: 20, width: 1000, height: 4096 };
  const cropB = { height: 4096, width: 1000, y: 20, x: 10 } as Rect;
  const pixelA = { width: 1000, height: 4096 };
  const pixelB = { height: 4096, width: 1000 } as Size;

  const first = tileKey(unit("a", cropA, pixelA, 1, 1));
  const second = tileKey(unit("b", cropB, pixelB, 1.0000000001, 1));

  assert.equal(first, second);
  assert.deepEqual(Object.keys(JSON.parse(first)).slice(-9), [
    "cropX",
    "cropY",
    "cropWidth",
    "cropHeight",
    "pixelWidth",
    "pixelHeight",
    "scaleX",
    "scaleY",
    "preprocessingVersion",
  ]);
});

test("buildOcrCacheKey separates tile pixel dimensions and scales", () => {
  const crop = { x: 0, y: 0, width: 1000, height: 4096 };
  const base = tileKey(unit("base", crop, { width: 1000, height: 4096 }, 1, 1));
  const differentPixels = tileKey(unit("pixels", crop, { width: 2000, height: 8192 }, 1, 1));
  const differentScale = tileKey(unit("scale", crop, { width: 1000, height: 4096 }, 2, 2));

  assert.notEqual(base, differentPixels);
  assert.notEqual(base, differentScale);
  assert.notEqual(differentPixels, differentScale);
});

function tileKey(recognitionUnit: RecognitionUnit): string {
  return buildOcrCacheKey("direct:image_base64:ocr:abc+openai-compatible:gpt", {
    imageHash: "same-image",
    width: 1000,
    height: 16000,
    sourceLanguage: "auto",
    recognitionUnit,
  });
}

function unit(id: string, crop: Rect, pixelSize: Size, scaleX: number, scaleY: number): RecognitionUnit {
  return {
    id,
    parentSurfaceId: "surface",
    crop,
    naturalSize: { width: 1000, height: 16000 },
    pixelSize,
    scaleX,
    scaleY,
    priority: "p0",
    reason: "automatic",
    preprocessingVersion: "lossless-png-tile-v1",
  };
}
