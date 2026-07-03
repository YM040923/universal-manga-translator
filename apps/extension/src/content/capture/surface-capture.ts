import type { SurfaceTask } from "@umt/shared/types";
import type { DetectedSurface } from "../detector/surface-detector";
import { requestImageData } from "./image-data-request.js";

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

export interface CreateSurfaceTaskWithImageDataOptions {
  allowImageUrlFallback?: boolean;
}

export async function createSurfaceTaskWithImageData(
  surface: DetectedSurface,
  priority: SurfaceTask["viewportPriority"],
  targetLanguage = "zh-CN",
  options: CreateSurfaceTaskWithImageDataOptions = {},
): Promise<SurfaceTask> {
  if (surface.imageData || !surface.imageUrl) return createSurfaceTask(surface, priority, targetLanguage);
  try {
    const imageData = await requestImageData(surface.imageUrl, location.href);
    const { imageUrl: _imageUrl, ...surfaceWithoutUrl } = surface;
    void _imageUrl;
    return createSurfaceTask({ ...surfaceWithoutUrl, imageData }, priority, targetLanguage);
  } catch (error) {
    if (options.allowImageUrlFallback === false) throw error;
    return createSurfaceTask(surface, priority, targetLanguage);
  }
}
