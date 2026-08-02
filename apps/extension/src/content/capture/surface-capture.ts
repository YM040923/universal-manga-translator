import type { RecognitionPriority } from "@umt/shared";
import type { SurfaceTask } from "@umt/shared/types";
import type { DetectedSurface } from "../detector/surface-detector";
import { requestImageData } from "./image-data-request.js";
import { createRecognitionCapture, type RecognitionCapture, type RecognitionCaptureSource } from "./recognition-capture.js";

export interface SurfaceTaskCapture {
  task: SurfaceTask;
  capture: RecognitionCapture;
}

export function createSurfaceTask(surface: DetectedSurface, priority: SurfaceTask["viewportPriority"], targetLanguage = "zh-CN"): SurfaceTask {
  return {
    surfaceId: surface.surfaceId,
    pageUrl: location.href,
    domain: location.hostname,
    ...(surface.imageUrl ? { imageUrl: surface.imageUrl } : {}),
    ...(surface.imageData ? { imageData: surface.imageData } : {}),
    viewportPriority: priority,
    surfaceRect: surface.rect,
    naturalSize: surface.naturalSize,
    renderSize: { width: surface.rect.width, height: surface.rect.height },
    readingDirection: "auto",
    sourceLanguage: "auto",
    targetLanguage,
  };
}

export function createSurfaceTaskCapture(
  surface: DetectedSurface,
  priority: RecognitionPriority,
  targetLanguage = "zh-CN",
  captureSource: RecognitionCaptureSource = surface.imageData ? "inline-image-data" : "image-url",
): SurfaceTaskCapture {
  return {
    task: createSurfaceTask(surface, priority, targetLanguage),
    capture: createRecognitionCapture({
      parentSurfaceId: surface.surfaceId,
      imageData: surface.imageData,
      naturalSize: surface.naturalSize,
      pixelSize: surface.naturalSize,
      priority,
      reason: "automatic",
      captureSource,
      devicePixelRatio: readDevicePixelRatio(),
    }),
  };
}

export interface CreateSurfaceTaskWithImageDataOptions {
  allowImageUrlFallback?: boolean;
}

export async function createSurfaceTaskWithImageData(
  surface: DetectedSurface,
  priority: RecognitionPriority,
  targetLanguage = "zh-CN",
  options: CreateSurfaceTaskWithImageDataOptions = {},
): Promise<SurfaceTask> {
  return (await createSurfaceTaskWithImageDataCapture(surface, priority, targetLanguage, options)).task;
}

export async function createSurfaceTaskWithImageDataCapture(
  surface: DetectedSurface,
  priority: RecognitionPriority,
  targetLanguage = "zh-CN",
  options: CreateSurfaceTaskWithImageDataOptions = {},
): Promise<SurfaceTaskCapture> {
  if (surface.imageData || !surface.imageUrl) return createSurfaceTaskCapture(surface, priority, targetLanguage);
  try {
    const imageData = await requestImageData(surface.imageUrl, location.href);
    const { imageUrl: _imageUrl, ...surfaceWithoutUrl } = surface;
    void _imageUrl;
    return createSurfaceTaskCapture({ ...surfaceWithoutUrl, imageData }, priority, targetLanguage, "image-fetch");
  } catch (error) {
    if (options.allowImageUrlFallback === false) throw error;
    return createSurfaceTaskCapture(surface, priority, targetLanguage, "image-url");
  }
}

function readDevicePixelRatio(): number {
  return typeof globalThis.devicePixelRatio === "number" ? globalThis.devicePixelRatio : 1;
}
