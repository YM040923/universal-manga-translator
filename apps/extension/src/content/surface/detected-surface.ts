import type { DetectedSurface } from "../detector/surface-detector";
import type { RegisteredSurface } from "./surface-registry";

export function toDetectedSurface(surface: RegisteredSurface): DetectedSurface {
  const rect = surface.element.getBoundingClientRect();
  return {
    surfaceId: surface.surfaceId,
    kind: "image",
    element: surface.element,
    imageUrl: surface.imageUrl,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    naturalSize: surface.naturalSize,
    score: 10,
  };
}
