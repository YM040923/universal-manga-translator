import type { RegisteredSurface } from "./surface-registry.js";

export interface ViewportLike {
  innerHeight: number;
}

export function selectVisibleSurfaces(surfaces: RegisteredSurface[], viewport: ViewportLike = window, marginPx = 320): RegisteredSurface[] {
  return surfaces.filter((surface) => isSurfaceVisible(surface, viewport, marginPx)).sort((a, b) => a.index - b.index);
}

export function isSurfaceVisible(surface: RegisteredSurface, viewport: ViewportLike = window, marginPx = 320): boolean {
  const rect = surface.element.getBoundingClientRect();
  const top = rect.top;
  const bottom = rect.bottom;
  return bottom >= -marginPx && top <= viewport.innerHeight + marginPx;
}
