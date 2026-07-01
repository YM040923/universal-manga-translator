import { visibleRatio } from "@umt/shared/geometry";
import type { Priority, Rect } from "@umt/shared/types";
import type { DetectedSurface } from "../detector/surface-detector";

export interface PrioritizedSurface {
  surface: DetectedSurface;
  priority: Priority;
  distance: number;
  visibleRatio: number;
}

export interface SurfaceSelectionOptions {
  imageRange: "viewport" | "fullPage";
  maxFullPageSurfaces: number;
  pretranslateNextPage: boolean;
}

export function prioritizeSurfaces(surfaces: DetectedSurface[], viewport: Rect): PrioritizedSurface[] {
  return surfaces.map((surface) => {
    const ratio = visibleRatio(surface.rect, viewport);
    const distance = surface.rect.y - (viewport.y + viewport.height);
    const priority: Priority = ratio > 0.05 ? "p0" : distance >= -viewport.height && distance <= viewport.height * 2 ? "p1" : "p2";
    return { surface, priority, distance, visibleRatio: ratio };
  }).sort(comparePrioritizedSurfaces);
}

export function selectSurfacesForMode(surfaces: PrioritizedSurface[], options: SurfaceSelectionOptions): PrioritizedSurface[] {
  if (options.imageRange === "fullPage") return surfaces.slice(0, options.maxFullPageSurfaces);
  const allowed = options.pretranslateNextPage ? new Set<Priority>(["p0", "p1"]) : new Set<Priority>(["p0"]);
  return surfaces.filter((item) => allowed.has(item.priority));
}

function comparePrioritizedSurfaces(a: PrioritizedSurface, b: PrioritizedSurface): number {
  const priorityDelta = priorityRank(a.priority) - priorityRank(b.priority);
  if (priorityDelta !== 0) return priorityDelta;
  if (a.priority === "p0" && a.visibleRatio !== b.visibleRatio) return b.visibleRatio - a.visibleRatio;
  return Math.abs(a.distance) - Math.abs(b.distance);
}

function priorityRank(priority: Priority): number {
  if (priority === "p0") return 0;
  if (priority === "p1") return 1;
  if (priority === "p2") return 2;
  return 3;
}
