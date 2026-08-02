import type { RecognitionPriority, RecognitionReason, RecognitionUnit, Rect, Size } from "@umt/shared";

export type RecognitionCaptureSource = "image-fetch" | "image-url" | "inline-image-data" | "manual-selection";

export interface RecognitionCapture {
  unit: RecognitionUnit;
  imageData: string | undefined;
  mimeType: string;
  byteLength: number;
  devicePixelRatio: number;
  viewportScaleX?: number;
  viewportScaleY?: number;
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
  viewportScaleX?: number;
  viewportScaleY?: number;
}

const PREPROCESSING_VERSION = "none-v1";
const DEFAULT_MIME_TYPE = "application/octet-stream";
const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const BASE64_METADATA_TOKEN_PATTERN = /^[\t\n\f\r ]*base64[\t\n\f\r ]*$/i;

export function createRecognitionCapture(input: CreateRecognitionCaptureInput): RecognitionCapture {
  const crop = input.crop ?? { x: 0, y: 0, width: input.naturalSize.width, height: input.naturalSize.height };
  validateSize("naturalSize", input.naturalSize);
  validateSize("pixelSize", input.pixelSize);
  validateCrop(crop, input.naturalSize);
  const scaleX = input.pixelSize.width / crop.width;
  const scaleY = input.pixelSize.height / crop.height;
  validatePositiveFiniteNumber("scaleX", scaleX);
  validatePositiveFiniteNumber("scaleY", scaleY);
  const devicePixelRatio = input.devicePixelRatio ?? 1;
  validatePositiveFiniteNumber("devicePixelRatio", devicePixelRatio);
  validateViewportScales(input.viewportScaleX, input.viewportScaleY);
  const mimeType = input.mimeType === undefined
    ? readDataUrlMimeType(input.imageData) ?? DEFAULT_MIME_TYPE
    : normalizeMimeType(input.mimeType) ?? DEFAULT_MIME_TYPE;
  return {
    unit: createRecognitionUnit({
      parentSurfaceId: input.parentSurfaceId,
      naturalSize: input.naturalSize,
      pixelSize: input.pixelSize,
      crop,
      scaleX,
      scaleY,
      priority: input.priority,
      reason: input.reason,
    }),
    imageData: input.imageData,
    mimeType,
    byteLength: readImageDataByteLength(input.imageData),
    devicePixelRatio,
    ...(input.viewportScaleX !== undefined ? { viewportScaleX: input.viewportScaleX } : {}),
    ...(input.viewportScaleY !== undefined ? { viewportScaleY: input.viewportScaleY } : {}),
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
    ...(capture.viewportScaleX !== undefined && capture.viewportScaleY !== undefined
      ? [`viewportScale=${capture.viewportScaleX}x${capture.viewportScaleY}`]
      : []),
    `bytes=${capture.byteLength}`,
  ].join(" | ");
}

function createRecognitionUnit(input: {
  parentSurfaceId: string;
  naturalSize: Size;
  pixelSize: Size;
  crop: Rect;
  scaleX: number;
  scaleY: number;
  priority: RecognitionPriority;
  reason: RecognitionReason;
}): RecognitionUnit {
  return {
    id: `${input.parentSurfaceId}:${input.reason}:${input.crop.x},${input.crop.y},${input.crop.width}x${input.crop.height}`,
    parentSurfaceId: input.parentSurfaceId,
    crop: input.crop,
    naturalSize: input.naturalSize,
    pixelSize: input.pixelSize,
    scaleX: input.scaleX,
    scaleY: input.scaleY,
    priority: input.priority,
    reason: input.reason,
    preprocessingVersion: PREPROCESSING_VERSION,
  };
}

function readDataUrlMimeType(imageData: string | undefined): string | undefined {
  const parsed = parseDataUrl(imageData);
  if (!parsed) return undefined;
  const mediaType = parsed.header.split(";", 1)[0] ?? "";
  return normalizeMimeType(mediaType);
}

function readImageDataByteLength(imageData: string | undefined): number {
  if (!imageData) return 0;
  const parsed = parseDataUrl(imageData);
  if (!parsed) return new TextEncoder().encode(imageData).byteLength;
  if (!parsed.isBase64) return readPercentEncodedByteLength(parsed.payload);
  return readBase64ByteLength(parsed.payload);
}

function parseDataUrl(imageData: string | undefined): { header: string; payload: string; isBase64: boolean } | undefined {
  if (!imageData || !/^data:/i.test(imageData)) return undefined;
  const commaIndex = imageData.indexOf(",");
  if (commaIndex < 0) throw new Error("Invalid image data URL: missing comma separator.");
  const header = imageData.slice(5, commaIndex);
  const finalParameterSeparatorIndex = header.lastIndexOf(";");
  const finalMetadataToken = finalParameterSeparatorIndex < 0 ? undefined : header.slice(finalParameterSeparatorIndex + 1);
  return {
    header,
    payload: imageData.slice(commaIndex + 1),
    isBase64: finalMetadataToken !== undefined && BASE64_METADATA_TOKEN_PATTERN.test(finalMetadataToken),
  };
}

function readBase64ByteLength(payload: string): number {
  let decodedPayload = "";
  for (let index = 0; index < payload.length; index += 1) {
    const character = payload[index]!;
    if (character !== "%") {
      decodedPayload += character;
      continue;
    }
    const hex = payload.slice(index + 1, index + 3);
    if (!/^[0-9a-f]{2}$/i.test(hex)) throw new Error("Invalid base64 image data: malformed percent encoding.");
    decodedPayload += String.fromCharCode(Number.parseInt(hex, 16));
    index += 2;
  }
  let normalized = decodedPayload.replace(/[\t\n\f\r ]+/g, "");
  if (normalized.length % 4 === 0) {
    if (normalized.endsWith("==")) normalized = normalized.slice(0, -2);
    else if (normalized.endsWith("=")) normalized = normalized.slice(0, -1);
  }
  if (normalized.length % 4 === 1 || !/^[a-z0-9+/]*$/i.test(normalized)) {
    throw new Error("Invalid base64 image data: payload is malformed or truncated.");
  }
  return Math.floor(normalized.length * 6 / 8);
}

function readPercentEncodedByteLength(payload: string): number {
  const encoder = new TextEncoder();
  let byteLength = 0;
  let rawStart = 0;
  for (let index = 0; index < payload.length; index += 1) {
    if (payload[index] !== "%" || !/^[0-9a-f]{2}$/i.test(payload.slice(index + 1, index + 3))) continue;
    byteLength += encoder.encode(payload.slice(rawStart, index)).byteLength + 1;
    index += 2;
    rawStart = index + 1;
  }
  return byteLength + encoder.encode(payload.slice(rawStart)).byteLength;
}

function normalizeMimeType(value: string): string | undefined {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType && MEDIA_TYPE_PATTERN.test(mediaType) ? mediaType : undefined;
}

function validateSize(name: "naturalSize" | "pixelSize", size: Size): void {
  validatePositiveFiniteNumber(`${name}.width`, size.width);
  validatePositiveFiniteNumber(`${name}.height`, size.height);
}

function validateCrop(crop: Rect, naturalSize: Size): void {
  validateNonNegativeFiniteNumber("crop.x", crop.x);
  validateNonNegativeFiniteNumber("crop.y", crop.y);
  validatePositiveFiniteNumber("crop.width", crop.width);
  validatePositiveFiniteNumber("crop.height", crop.height);
  if (
    crop.width > naturalSize.width
    || crop.height > naturalSize.height
    || crop.x > naturalSize.width - crop.width
    || crop.y > naturalSize.height - crop.height
  ) {
    throw new Error("Recognition capture crop must fit within naturalSize bounds.");
  }
}

function validateViewportScales(viewportScaleX: number | undefined, viewportScaleY: number | undefined): void {
  if ((viewportScaleX === undefined) !== (viewportScaleY === undefined)) {
    throw new Error("Recognition capture viewportScaleX and viewportScaleY must be provided together.");
  }
  if (viewportScaleX === undefined || viewportScaleY === undefined) return;
  validatePositiveFiniteNumber("viewportScaleX", viewportScaleX);
  validatePositiveFiniteNumber("viewportScaleY", viewportScaleY);
}

function validateNonNegativeFiniteNumber(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Recognition capture ${name} must be a finite number.`);
  }
  if (value < 0) throw new Error(`Recognition capture ${name} must be at least 0.`);
}

function validatePositiveFiniteNumber(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Recognition capture ${name} must be finite and greater than 0.`);
  }
  if (value <= 0) throw new Error(`Recognition capture ${name} must be greater than 0.`);
}

function formatSize(size: Size): string {
  return `${size.width}x${size.height}`;
}
