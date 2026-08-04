import type { DetectedSurface } from "../detector/surface-detector.js";
import type { RegisteredSurface } from "./surface-registry.js";

export function toDetectedSurface(surface: RegisteredSurface): DetectedSurface {
  const rect = surface.element.getBoundingClientRect();
  return {
    surfaceId: surface.surfaceId,
    kind: surface.kind ?? "image",
    element: surface.element,
    ...(surface.imageUrl ? { imageUrl: surface.imageUrl } : {}),
    ...(surface.imageData ? { imageData: surface.imageData } : {}),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    naturalSize: surface.naturalSize,
    score: 10,
  };
}
