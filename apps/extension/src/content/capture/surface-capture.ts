import type { Size, SurfaceTask } from "@umt/shared/types";
import type { DetectedSurface } from "../detector/surface-detector";
import { requestImageData } from "./image-data-request.js";
import { clampCropRectToImage, cropScreenshotDataUrl, readImageSize, type ScreenshotCropRect } from "./screenshot-crop.js";
import { requestVisibleTabScreenshot } from "./screenshot-request.js";

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
  /** Direct mode: when the CDN image fetch fails, crop a viewport screenshot of the image instead of failing the whole surface. */
  allowScreenshotFallback?: boolean;
  __testScreenshot?: () => Promise<string>;
  __testReadScreenshotSize?: (dataUrl: string) => Promise<Size>;
  __testCropScreenshot?: (dataUrl: string, crop: ScreenshotCropRect) => Promise<string>;
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
    if (options.allowScreenshotFallback) {
      const fallback = await screenshotSurfaceFallback(surface, priority, targetLanguage, options);
      if (fallback) return fallback;
    }
    if (options.allowImageUrlFallback === false) throw error;
    return createSurfaceTask(surface, priority, targetLanguage);
  }
}

/**
 * Crops the visible tab screenshot to the image's current viewport rect.
 * Only used when the image is fully inside the viewport so the crop maps
 * 1:1 onto the image element for overlay rendering.
 */
async function screenshotSurfaceFallback(
  surface: DetectedSurface,
  priority: SurfaceTask["viewportPriority"],
  targetLanguage: string,
  options: CreateSurfaceTaskWithImageDataOptions,
): Promise<SurfaceTask | null> {
  const rect = surface.element.getBoundingClientRect();
  const fullyVisible = rect.width >= 2
    && rect.height >= 2
    && rect.left >= 0
    && rect.top >= 0
    && rect.right <= window.innerWidth + 1
    && rect.bottom <= window.innerHeight + 1;
  if (!fullyVisible) return null;
  try {
    const screenshotDataUrl = options.__testScreenshot ? await options.__testScreenshot() : await requestVisibleTabScreenshot();
    const screenshotSize = options.__testReadScreenshotSize ? await options.__testReadScreenshotSize(screenshotDataUrl) : await readImageSize(screenshotDataUrl);
    const crop = clampCropRectToImage(rect, { width: window.innerWidth, height: window.innerHeight }, screenshotSize);
    if (crop.width < 2 || crop.height < 2) return null;
    const imageData = options.__testCropScreenshot ? await options.__testCropScreenshot(screenshotDataUrl, crop) : await cropScreenshotDataUrl(screenshotDataUrl, crop);
    return createSurfaceTask({
      surfaceId: surface.surfaceId,
      kind: "screenshot",
      element: surface.element,
      imageData,
      rect: surface.rect,
      naturalSize: { width: crop.width, height: crop.height },
      score: surface.score,
    }, priority, targetLanguage);
  } catch {
    return null;
  }
}
