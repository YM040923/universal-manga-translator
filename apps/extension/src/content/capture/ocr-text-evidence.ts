import type { RecognitionUnit, Size } from "@umt/shared";

export const OCR_TEXT_EVIDENCE_MAX_LONG_EDGE = 256;
export const OCR_TEXT_EVIDENCE_MAX_PIXEL_AREA = OCR_TEXT_EVIDENCE_MAX_LONG_EDGE ** 2;
export const OCR_TEXT_EVIDENCE_EDGE_DELTA = 28;
export const OCR_TEXT_EVIDENCE_MIN_EDGE = 0.002;
export const OCR_TEXT_EVIDENCE_MAX_EDGE = 0.42;
export const OCR_TEXT_EVIDENCE_MIN_CANDIDATE_WINDOWS = 2;
const OCR_TEXT_EVIDENCE_MIN_BRIGHT_MEAN = 155;
const OCR_TEXT_EVIDENCE_MIN_BRIGHT_RATIO = 0.62;
const OCR_TEXT_EVIDENCE_MIN_DARK_RATIO = 0.015;
const OCR_TEXT_EVIDENCE_MAX_DARK_RATIO = 0.38;
const OCR_TEXT_EVIDENCE_MIN_WINDOW_EDGE = 0.012;
const OCR_TEXT_EVIDENCE_MAX_WINDOW_EDGE = 0.28;
const OCR_TEXT_EVIDENCE_MIN_WINDOW_CONTRAST = 0.05;
const OCR_TEXT_EVIDENCE_MAX_WINDOW_CONTRAST = 0.5;
const OCR_TEXT_EVIDENCE_MAX_SATURATION = 0.18;

export interface OcrTextEvidencePixelInput {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface DirectOcrTextEvidenceInput {
  imageBytes: Uint8Array;
  imageSize: Size;
  recognitionUnit: RecognitionUnit;
}

export interface DirectOcrTextEvidenceAssessment {
  likelyText: boolean;
  edgeDensity: number;
  contrast: number;
  candidateWindowCount: number;
}

export type DirectOcrTextEvidenceProvider = (
  input: DirectOcrTextEvidenceInput,
) => Promise<DirectOcrTextEvidenceAssessment> | DirectOcrTextEvidenceAssessment;

export type OcrTextEvidencePixelReader = (
  input: DirectOcrTextEvidenceInput,
) => Promise<OcrTextEvidencePixelInput>;

export interface BrowserOcrTextEvidenceProviderOptions {
  readPixels?: OcrTextEvidencePixelReader;
}

const EMPTY_EVIDENCE: DirectOcrTextEvidenceAssessment = Object.freeze({
  likelyText: false,
  edgeDensity: 0,
  contrast: 0,
  candidateWindowCount: 0,
});

export function analyzeOcrTextEvidencePixels(
  input: OcrTextEvidencePixelInput,
): DirectOcrTextEvidenceAssessment {
  validatePixelInput(input);
  const pixelCount = input.width * input.height;
  const luminance = new Uint8Array(pixelCount);
  const saturation = new Uint8Array(pixelCount);
  let sum = 0;
  let sumSquares = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const alpha = input.data[offset + 3]! / 255;
    const red = blendWhite(input.data[offset]!, alpha);
    const green = blendWhite(input.data[offset + 1]!, alpha);
    const blue = blendWhite(input.data[offset + 2]!, alpha);
    const value = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
    luminance[pixel] = value;
    saturation[pixel] = Math.max(red, green, blue) - Math.min(red, green, blue);
    sum += value;
    sumSquares += value * value;
  }
  const mean = sum / pixelCount;
  const contrast = roundMetric(Math.sqrt(Math.max(0, sumSquares / pixelCount - mean * mean)) / 127.5);
  const edgeDensity = roundMetric(measureEdgeDensity(luminance, input.width, input.height, 0, 0, input.width, input.height));
  const candidateWindowCount = countCandidateWindows(luminance, saturation, input.width, input.height);
  return {
    likelyText:
      candidateWindowCount >= OCR_TEXT_EVIDENCE_MIN_CANDIDATE_WINDOWS
      && edgeDensity >= OCR_TEXT_EVIDENCE_MIN_EDGE
      && edgeDensity <= OCR_TEXT_EVIDENCE_MAX_EDGE,
    edgeDensity,
    contrast,
    candidateWindowCount,
  };
}

export function createBrowserOcrTextEvidenceProvider(
  options: BrowserOcrTextEvidenceProviderOptions = {},
): DirectOcrTextEvidenceProvider {
  const readPixels = options.readPixels ?? readBrowserOcrTextEvidencePixels;
  return async (input) => {
    try {
      return analyzeOcrTextEvidencePixels(await readPixels(input));
    } catch {
      return { ...EMPTY_EVIDENCE };
    }
  };
}

export async function readBrowserOcrTextEvidencePixels(
  input: DirectOcrTextEvidenceInput,
): Promise<OcrTextEvidencePixelInput> {
  validateProviderInput(input);
  const decoded = await decodeImageBytes(input.imageBytes);
  const dimensions = downsampleDimensions(decoded.width, decoded.height);
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(imageData.data) };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    decoded.release();
  }
}

function countCandidateWindows(
  luminance: Uint8Array,
  saturation: Uint8Array,
  width: number,
  height: number,
): number {
  const shortestEdge = Math.min(width, height);
  const windowSize = Math.max(16, Math.min(48, Math.floor(shortestEdge / 3)));
  const stride = Math.max(8, Math.floor(windowSize / 2));
  let candidates = 0;
  for (let top = 0; top + windowSize <= height; top += stride) {
    for (let left = 0; left + windowSize <= width; left += stride) {
      const metrics = measureWindow(luminance, saturation, width, height, left, top, windowSize, windowSize);
      if (
        metrics.mean >= OCR_TEXT_EVIDENCE_MIN_BRIGHT_MEAN
        && metrics.brightRatio >= OCR_TEXT_EVIDENCE_MIN_BRIGHT_RATIO
        && metrics.darkRatio >= OCR_TEXT_EVIDENCE_MIN_DARK_RATIO
        && metrics.darkRatio <= OCR_TEXT_EVIDENCE_MAX_DARK_RATIO
        && metrics.edgeDensity >= OCR_TEXT_EVIDENCE_MIN_WINDOW_EDGE
        && metrics.edgeDensity <= OCR_TEXT_EVIDENCE_MAX_WINDOW_EDGE
        && metrics.contrast >= OCR_TEXT_EVIDENCE_MIN_WINDOW_CONTRAST
        && metrics.contrast <= OCR_TEXT_EVIDENCE_MAX_WINDOW_CONTRAST
        && metrics.saturation <= OCR_TEXT_EVIDENCE_MAX_SATURATION
      ) {
        candidates += 1;
      }
    }
  }
  return candidates;
}

function measureWindow(
  luminance: Uint8Array,
  saturation: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  left: number,
  top: number,
  width: number,
  height: number,
): {
  mean: number;
  brightRatio: number;
  darkRatio: number;
  edgeDensity: number;
  contrast: number;
  saturation: number;
} {
  const count = width * height;
  let sum = 0;
  let sumSquares = 0;
  let bright = 0;
  let dark = 0;
  let saturationSum = 0;
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const pixel = y * imageWidth + x;
      const value = luminance[pixel]!;
      sum += value;
      sumSquares += value * value;
      if (value >= 185) bright += 1;
      if (value <= 105) dark += 1;
      saturationSum += saturation[pixel]!;
    }
  }
  const mean = sum / count;
  return {
    mean,
    brightRatio: bright / count,
    darkRatio: dark / count,
    edgeDensity: measureEdgeDensity(luminance, imageWidth, imageHeight, left, top, width, height),
    contrast: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)) / 127.5,
    saturation: saturationSum / count / 255,
  };
}

function measureEdgeDensity(
  luminance: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  left: number,
  top: number,
  width: number,
  height: number,
): number {
  let edges = 0;
  let comparisons = 0;
  const right = Math.min(imageWidth, left + width);
  const bottom = Math.min(imageHeight, top + height);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const value = luminance[y * imageWidth + x]!;
      if (x + 1 < right) {
        if (Math.abs(value - luminance[y * imageWidth + x + 1]!) >= OCR_TEXT_EVIDENCE_EDGE_DELTA) edges += 1;
        comparisons += 1;
      }
      if (y + 1 < bottom) {
        if (Math.abs(value - luminance[(y + 1) * imageWidth + x]!) >= OCR_TEXT_EVIDENCE_EDGE_DELTA) edges += 1;
        comparisons += 1;
      }
    }
  }
  return comparisons > 0 ? edges / comparisons : 0;
}

function validatePixelInput(input: OcrTextEvidencePixelInput): void {
  if (
    !Number.isInteger(input.width)
    || !Number.isInteger(input.height)
    || input.width <= 0
    || input.height <= 0
    || input.width > OCR_TEXT_EVIDENCE_MAX_LONG_EDGE
    || input.height > OCR_TEXT_EVIDENCE_MAX_LONG_EDGE
    || input.width * input.height > OCR_TEXT_EVIDENCE_MAX_PIXEL_AREA
  ) {
    throw new Error("OCR text evidence pixels exceed the safe analysis size");
  }
  if (input.data.length !== input.width * input.height * 4) {
    throw new Error("OCR text evidence RGBA length does not match dimensions");
  }
}

function validateProviderInput(input: DirectOcrTextEvidenceInput): void {
  if (input.imageBytes.byteLength <= 0) throw new Error("OCR text evidence image bytes are empty");
  for (const value of [
    input.imageSize.width,
    input.imageSize.height,
    input.recognitionUnit.pixelSize.width,
    input.recognitionUnit.pixelSize.height,
  ]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error("OCR text evidence dimensions must be positive and finite");
  }
}

function downsampleDimensions(width: number, height: number): Size {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Decoded OCR text evidence image has invalid dimensions");
  }
  const scale = Math.min(1, OCR_TEXT_EVIDENCE_MAX_LONG_EDGE / Math.max(width, height));
  const result = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
  if (result.width * result.height > OCR_TEXT_EVIDENCE_MAX_PIXEL_AREA) {
    throw new Error("OCR text evidence downsample exceeds the safe pixel area");
  }
  return result;
}

interface DecodedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

async function decodeImageBytes(bytes: Uint8Array): Promise<DecodedImage> {
  const blob = new Blob([uint8ArrayToArrayBuffer(bytes)]);
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Failed to decode OCR text evidence image"));
      image.src = objectUrl;
    });
    return {
      image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
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

function blendWhite(value: number, alpha: number): number {
  return Math.round(255 - (255 - value) * alpha);
}

function roundMetric(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}
