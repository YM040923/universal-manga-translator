import { visibleRatio } from "@umt/shared/geometry";
import type { Priority, Rect } from "@umt/shared/types";
import type { DetectedSurface } from "../detector/surface-detector";

export interface PrioritizedSurface {
  surface: DetectedSurface;
  priority: Priority;
}

export function prioritizeSurfaces(surfaces: DetectedSurface[], viewport: Rect): PrioritizedSurface[] {
  return surfaces.map((surface) => {
    const ratio = visibleRatio(surface.rect, viewport);
    const distance = surface.rect.y - (viewport.y + viewport.height);
    const priority: Priority = ratio > 0.05 ? "p0" : distance >= -viewport.height && distance <= viewport.height * 2 ? "p1" : "p2";
    return { surface, priority };
  });
}
