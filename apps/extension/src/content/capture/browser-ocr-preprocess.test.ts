import test from "node:test";
import assert from "node:assert/strict";
import {
  getOcrPreprocessVariant,
  type CoreOcrPreprocessSourceInput,
  type OcrPreprocessVariant,
} from "@umt/core";
import type { RecognitionUnit } from "@umt/shared";
import {
  createBrowserOcrPreprocessLoader,
  type BrowserOcrVariantRenderer,
} from "./browser-ocr-preprocess.js";

test("browser OCR preprocess loader generates only the requested variant", async () => {
  const rendered: string[] = [];
  const renderer: BrowserOcrVariantRenderer = async (_source, variant, transformedUnit) => {
    rendered.push(variant.id);
    assert.equal(transformedUnit.reason, "ocr-rescue");
    assert.equal(transformedUnit.preprocessingVersion, variant.version);
    return { imageBytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
  };
  const loader = createBrowserOcrPreprocessLoader({ renderer });
  let consumedVariant = "";

  await loader.withVariant(source(), getOcrPreprocessVariant("grayscale-contrast"), async (input) => {
    consumedVariant = input.ocrVariant ?? "";
    assert.equal(input.imageBytes.byteLength, 3);
    assert.equal(input.mimeType, "image/png");
  });

  assert.deepEqual(rendered, ["grayscale-contrast"]);
  assert.equal(consumedVariant, "grayscale-contrast");
});

test("browser OCR preprocess loader serializes variant bytes and releases each input after consume", async () => {
  let activeVariantBytes = 0;
  let maximumActiveVariantBytes = 0;
  let lastConsumedInput: { imageBytes: Uint8Array } | undefined;
  const renderer: BrowserOcrVariantRenderer = async (_source, variant) => {
    assert.equal(lastConsumedInput?.imageBytes.byteLength ?? 0, 0);
    activeVariantBytes += 1;
    maximumActiveVariantBytes = Math.max(maximumActiveVariantBytes, activeVariantBytes);
    return { imageBytes: new Uint8Array([variant.id.length]), mimeType: "image/png" };
  };
  const loader = createBrowserOcrPreprocessLoader({ renderer });
  const consumed: string[] = [];

  await Promise.all([
    loader.withVariant(source(), getOcrPreprocessVariant("grayscale-contrast"), async (input) => {
      lastConsumedInput = input;
      assert.equal(activeVariantBytes, 1);
      consumed.push(input.ocrVariant ?? "");
      await delay(5);
      activeVariantBytes -= 1;
    }),
    loader.withVariant(source("tile-2"), getOcrPreprocessVariant("upscale-2x"), async (input) => {
      lastConsumedInput = input;
      assert.equal(activeVariantBytes, 1);
      consumed.push(input.ocrVariant ?? "");
      await delay(5);
      activeVariantBytes -= 1;
    }),
  ]);

  assert.equal(maximumActiveVariantBytes, 1);
  assert.deepEqual(consumed, ["grayscale-contrast", "upscale-2x"]);
  assert.equal(lastConsumedInput?.imageBytes.byteLength, 0);
});

function source(id = "tile-1"): CoreOcrPreprocessSourceInput {
  return {
    imageBytes: new Uint8Array([9, 8, 7]),
    fileName: `${id}.png`,
    mimeType: "image/png",
    recognitionUnit: unit(id),
  };
}

function unit(id: string): RecognitionUnit {
  return {
    id,
    parentSurfaceId: "surface-1",
    crop: { x: 0, y: 0, width: 100, height: 80 },
    naturalSize: { width: 100, height: 80 },
    pixelSize: { width: 100, height: 80 },
    scaleX: 1,
    scaleY: 1,
    priority: "p0",
    reason: "automatic",
    preprocessingVersion: "none-v1",
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
