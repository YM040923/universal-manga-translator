import type { SurfaceTask } from "@umt/shared/types";
import type { DetectedSurface } from "../detector/surface-detector";

export function createSurfaceTask(surface: DetectedSurface, priority: SurfaceTask["viewportPriority"]): SurfaceTask {
  return {
    surfaceId: surface.surfaceId,
    pageUrl: location.href,
    domain: location.hostname,
    imageUrl: surface.imageUrl,
    viewportPriority: priority,
    surfaceRect: surface.rect,
    naturalSize: surface.naturalSize,
    renderSize: { width: surface.rect.width, height: surface.rect.height },
    readingDirection: "auto",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
  };
}
