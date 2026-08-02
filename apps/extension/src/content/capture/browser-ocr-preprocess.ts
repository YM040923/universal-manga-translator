import {
  applyOcrPreprocessVariantToUnit,
  type CoreOcrPreprocessLoader,
  type CoreOcrPreprocessSourceInput,
  type CorePreCroppedOcrInput,
  type OcrPreprocessVariant,
} from "@umt/core";
import type { RecognitionUnit } from "@umt/shared";

export interface BrowserOcrVariantRenderResult {
  imageBytes: Uint8Array;
  mimeType: "image/png";
}

export type BrowserOcrVariantRenderer = (
  source: CoreOcrPreprocessSourceInput,
  variant: OcrPreprocessVariant,
  transformedUnit: RecognitionUnit,
) => Promise<BrowserOcrVariantRenderResult>;

export interface BrowserOcrPreprocessLoaderOptions {
  renderer?: BrowserOcrVariantRenderer;
}

const RELEASED_VARIANT_BYTES = new Uint8Array(0);

export function createBrowserOcrPreprocessLoader(
  options: BrowserOcrPreprocessLoaderOptions = {},
): CoreOcrPreprocessLoader {
  const renderer = options.renderer ?? renderBrowserOcrVariant;
  let tail: Promise<void> = Promise.resolve();
  return {
    withVariant: async <T>(
      source: CoreOcrPreprocessSourceInput,
      variant: OcrPreprocessVariant,
      consume: (input: CorePreCroppedOcrInput) => Promise<T>,
    ): Promise<T> => {
      let release!: () => void;
      const previous = tail;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        const recognitionUnit = applyOcrPreprocessVariantToUnit(source.recognitionUnit, variant);
        const rendered = await renderer(source, variant, recognitionUnit);
        const input: CorePreCroppedOcrInput = {
          imageBytes: rendered.imageBytes,
          fileName: `${variant.id}.png`,
          mimeType: rendered.mimeType,
          recognitionUnit,
          ocrVariant: variant.id,
        };
        try {
          return await consume(input);
        } finally {
          input.imageBytes = RELEASED_VARIANT_BYTES;
        }
      } finally {
        release();
      }
    },
  };
}

export async function renderBrowserOcrVariant(
  source: CoreOcrPreprocessSourceInput,
  variant: OcrPreprocessVariant,
  transformedUnit: RecognitionUnit,
): Promise<BrowserOcrVariantRenderResult> {
  const decoded = await decodeImageBytes(source.imageBytes, source.mimeType);
  const canvas = document.createElement("canvas");
  canvas.width = transformedUnit.pixelSize.width;
  canvas.height = transformedUnit.pixelSize.height;
  try {
    const context = canvas.getContext("2d", { willReadFrequently: variant.threshold === "adaptive" });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = variant.scale > 1;
    context.imageSmoothingQuality = "high";
    if (variant.grayscale || variant.contrast !== 1) {
      context.filter = `${variant.grayscale ? "grayscale(1)" : ""} contrast(${Math.round(variant.contrast * 100)}%)`.trim();
    }
    context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
    context.filter = "none";
    if (variant.threshold === "adaptive") applyAdaptiveThreshold(context, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas);
    return { imageBytes: new Uint8Array(await blob.arrayBuffer()), mimeType: "image/png" };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    decoded.release();
  }
}

interface DecodedImage {
  image: CanvasImageSource;
  release(): void;
}

async function decodeImageBytes(bytes: Uint8Array, mimeType = "application/octet-stream"): Promise<DecodedImage> {
  const blob = new Blob([uint8ArrayToArrayBuffer(bytes)], { type: mimeType });
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { image: bitmap, release: () => bitmap.close() };
  }
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Failed to decode OCR preprocess image bytes"));
      image.src = objectUrl;
    });
    return {
      image,
      release: () => {
        image.src = "";
        URL.revokeObjectURL(objectUrl);
      },
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function uint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function applyAdaptiveThreshold(context: CanvasRenderingContext2D, width: number, height: number): void {
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const luminance = new Uint8Array(width * height);
  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
    const value = Math.round(pixels[index]! * 0.299 + pixels[index + 1]! * 0.587 + pixels[index + 2]! * 0.114);
    luminance[pixel] = value;
  }
  const blockSize = 16;
  for (let blockY = 0; blockY < height; blockY += blockSize) {
    const bottom = Math.min(height, blockY + blockSize);
    for (let blockX = 0; blockX < width; blockX += blockSize) {
      const right = Math.min(width, blockX + blockSize);
      let sum = 0;
      for (let y = blockY; y < bottom; y += 1) {
        for (let x = blockX; x < right; x += 1) sum += luminance[y * width + x]!;
      }
      const threshold = sum / Math.max(1, (bottom - blockY) * (right - blockX)) - 8;
      for (let y = blockY; y < bottom; y += 1) {
        for (let x = blockX; x < right; x += 1) {
          const pixel = y * width + x;
          const output = luminance[pixel]! < threshold ? 0 : 255;
          const index = pixel * 4;
          pixels[index] = output;
          pixels[index + 1] = output;
          pixels[index + 2] = output;
          pixels[index + 3] = 255;
        }
      }
    }
  }
  context.putImageData(imageData, 0, 0);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode OCR preprocess variant as PNG"));
    }, "image/png");
  });
}
