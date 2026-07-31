import type { RecognitionPriority, RecognitionReason, RecognitionUnit, Rect, Size } from "@umt/shared";

export type RecognitionCaptureSource = "image-fetch" | "image-url" | "inline-image-data" | "manual-selection";

export interface RecognitionCapture {
  unit: RecognitionUnit;
  imageData: string | undefined;
  mimeType: string;
  byteLength: number;
  devicePixelRatio: number;
  captureSource: RecognitionCaptureSource;
}

export interface CreateRecognitionCaptureInput {
  parentSurfaceId: string;
  imageData: string | undefined;
  mimeType?: string;
  naturalSize: Size;
  pixelSize: Size;
  crop?: Rect;
  priority: RecognitionPriority;
  reason: RecognitionReason;
  captureSource: RecognitionCaptureSource;
  devicePixelRatio?: number;
}

const PREPROCESSING_VERSION = "none-v1";

export function createRecognitionCapture(input: CreateRecognitionCaptureInput): RecognitionCapture {
  const crop = input.crop ?? { x: 0, y: 0, width: input.naturalSize.width, height: input.naturalSize.height };
  return {
    unit: createRecognitionUnit({
      parentSurfaceId: input.parentSurfaceId,
      naturalSize: input.naturalSize,
      pixelSize: input.pixelSize,
      crop,
      priority: input.priority,
      reason: input.reason,
    }),
    imageData: input.imageData,
    mimeType: input.mimeType ?? readDataUrlMimeType(input.imageData) ?? "application/octet-stream",
    byteLength: readImageDataByteLength(input.imageData),
    devicePixelRatio: normalizePositiveNumber(input.devicePixelRatio, 1),
    captureSource: input.captureSource,
  };
}

export function formatRecognitionCaptureSummary(capture: RecognitionCapture): string {
  const { unit } = capture;
  return [
    `source=${capture.captureSource}`,
    `mime=${capture.mimeType}`,
    `dpr=${capture.devicePixelRatio}`,
    `natural=${formatSize(unit.naturalSize)}`,
    `pixel=${formatSize(unit.pixelSize)}`,
    `crop=${unit.crop.x},${unit.crop.y},${unit.crop.width}x${unit.crop.height}`,
    `scale=${unit.scaleX}x${unit.scaleY}`,
    `bytes=${capture.byteLength}`,
  ].join(" | ");
}

function createRecognitionUnit(input: {
  parentSurfaceId: string;
  naturalSize: Size;
  pixelSize: Size;
  crop: Rect;
  priority: RecognitionPriority;
  reason: RecognitionReason;
}): RecognitionUnit {
  return {
    id: `${input.parentSurfaceId}:${input.reason}:${input.crop.x},${input.crop.y},${input.crop.width}x${input.crop.height}`,
    parentSurfaceId: input.parentSurfaceId,
    crop: input.crop,
    naturalSize: input.naturalSize,
    pixelSize: input.pixelSize,
    scaleX: input.pixelSize.width / Math.max(1, input.crop.width),
    scaleY: input.pixelSize.height / Math.max(1, input.crop.height),
    priority: input.priority,
    reason: input.reason,
    preprocessingVersion: PREPROCESSING_VERSION,
  };
}

function readDataUrlMimeType(imageData: string | undefined): string | undefined {
  if (!imageData?.startsWith("data:")) return undefined;
  const match = /^data:([^;,]+)/i.exec(imageData);
  return match?.[1]?.toLowerCase();
}

function readImageDataByteLength(imageData: string | undefined): number {
  if (!imageData) return 0;
  const commaIndex = imageData.indexOf(",");
  if (!imageData.startsWith("data:") || commaIndex < 0) return new TextEncoder().encode(imageData).byteLength;
  const header = imageData.slice(0, commaIndex);
  const payload = imageData.slice(commaIndex + 1);
  if (!/;base64(?:;|$)/i.test(header)) return new TextEncoder().encode(safeDecodeURIComponent(payload)).byteLength;
  const normalized = payload.replace(/\s+/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(normalized.length * 3 / 4) - padding);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatSize(size: Size): string {
  return `${size.width}x${size.height}`;
}
