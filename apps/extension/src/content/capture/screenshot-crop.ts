import type { Rect, Size } from "@umt/shared/types";
import type { DetectedSurface } from "../detector/surface-detector.js";
import { createRecognitionCapture, type RecognitionCapture } from "./recognition-capture.js";

export interface ScreenshotCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
  upscale?: number;
}

export type ScreenshotCropper = (screenshotDataUrl: string, crop: ScreenshotCropRect) => Promise<string>;

export interface CreateScreenshotSurfaceInput {
  screenshotDataUrl: string;
  viewportRect: Rect;
  viewportSize: Size;
  screenshotSize: Size;
  surfaceId: string;
  element: HTMLElement;
  cropper?: ScreenshotCropper;
  upscale?: number;
  devicePixelRatio?: number;
}

export interface ScreenshotSurfaceCapture {
  surface: DetectedSurface;
  capture: RecognitionCapture;
}

export function clampCropRectToImage(viewportRect: Rect, viewportSize: Size, screenshotSize: Size): ScreenshotCropRect {
  const scaleX = screenshotSize.width / Math.max(1, viewportSize.width);
  const scaleY = screenshotSize.height / Math.max(1, viewportSize.height);
  const rawX = Math.round(viewportRect.x * scaleX);
  const rawY = Math.round(viewportRect.y * scaleY);
  const rawWidth = Math.round(viewportRect.width * scaleX);
  const rawHeight = Math.round(viewportRect.height * scaleY);
  const x = Math.max(0, Math.min(screenshotSize.width, rawX));
  const y = Math.max(0, Math.min(screenshotSize.height, rawY));
  const right = Math.max(x, Math.min(screenshotSize.width, rawX + rawWidth));
  const bottom = Math.max(y, Math.min(screenshotSize.height, rawY + rawHeight));
  return { x, y, width: right - x, height: bottom - y };
}

export async function createScreenshotSurface(input: CreateScreenshotSurfaceInput): Promise<DetectedSurface> {
  return (await createScreenshotSurfaceCapture(input)).surface;
}

export async function createScreenshotSurfaceCapture(input: CreateScreenshotSurfaceInput): Promise<ScreenshotSurfaceCapture> {
  const baseCrop = clampCropRectToImage(input.viewportRect, input.viewportSize, input.screenshotSize);
  if (baseCrop.width < 2 || baseCrop.height < 2) throw new Error("Screenshot crop is outside the visible screenshot");
  const upscale = normalizeUpscale(input.upscale);
  const crop = upscale > 1 ? { ...baseCrop, upscale } : baseCrop;
  const cropper = input.cropper ?? cropScreenshotDataUrl;
  const imageData = await cropper(input.screenshotDataUrl, crop);
  const pixelSize = { width: crop.width * (crop.upscale ?? 1), height: crop.height * (crop.upscale ?? 1) };
  const surface: DetectedSurface = {
    surfaceId: input.surfaceId,
    kind: "screenshot",
    element: input.element,
    imageData,
    rect: input.viewportRect,
    naturalSize: pixelSize,
    score: 999,
  };
  const scaleX = input.screenshotSize.width / Math.max(1, input.viewportSize.width);
  const scaleY = input.screenshotSize.height / Math.max(1, input.viewportSize.height);
  return {
    surface,
    capture: createRecognitionCapture({
      parentSurfaceId: input.surfaceId,
      imageData,
      naturalSize: pixelSize,
      pixelSize,
      priority: "p0",
      reason: "manual-selection",
      captureSource: "manual-selection",
      devicePixelRatio: input.devicePixelRatio ?? readDevicePixelRatio(),
      viewportScaleX: scaleX,
      viewportScaleY: scaleY,
    }),
  };
}

export async function readImageSize(dataUrl: string): Promise<Size> {
  const image = await loadImage(dataUrl);
  return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
}

export async function cropScreenshotDataUrl(screenshotDataUrl: string, crop: ScreenshotCropRect): Promise<string> {
  const image = await loadImage(screenshotDataUrl);
  const canvas = document.createElement("canvas");
  const upscale = normalizeUpscale(crop.upscale);
  if (crop.width < 2 || crop.height < 2) throw new Error("Screenshot crop is outside the visible screenshot");
  canvas.width = crop.width * upscale;
  canvas.height = crop.height * upscale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load screenshot image"));
    image.src = dataUrl;
  });
}

function normalizeUpscale(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 1 ? Math.min(4, Math.max(1, Math.round(value))) : 1;
}

function readDevicePixelRatio(): number {
  return typeof globalThis.devicePixelRatio === "number" ? globalThis.devicePixelRatio : 1;
}
