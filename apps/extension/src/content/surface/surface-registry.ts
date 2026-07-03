import type { Rect, Size } from "@umt/shared/types";

export interface RegisteredSurface {
  index: number;
  surfaceId: string;
  element: HTMLElement;
  imageUrl: string;
  rect: Rect;
  naturalSize: Size;
}

export class SurfaceRegistry {
  readonly surfaces: RegisteredSurface[];

  private constructor(surfaces: RegisteredSurface[]) {
    this.surfaces = surfaces;
  }

  static scan(root: Document = document): SurfaceRegistry {
    const candidates = [...root.images]
      .map((image, domIndex) => toRegisteredCandidate(image, domIndex, root.location.href))
      .filter((surface): surface is Omit<RegisteredSurface, "index"> & { domIndex: number } => surface !== null)
      .sort((a, b) => a.rect.y - b.rect.y || a.domIndex - b.domIndex);
    return new SurfaceRegistry(candidates.map(({ domIndex: _domIndex, ...surface }, index) => ({ ...surface, index: index + 1 })));
  }
}

function toRegisteredCandidate(image: HTMLImageElement, domIndex: number, pageUrl: string): (Omit<RegisteredSurface, "index"> & { domIndex: number }) | null {
  const rect = image.getBoundingClientRect();
  const naturalSize = { width: image.naturalWidth || Math.round(rect.width), height: image.naturalHeight || Math.round(rect.height) };
  if (!isMainMangaImage(rect, naturalSize)) return null;
  const imageUrl = absoluteImageUrl(image.currentSrc || image.src || image.getAttribute("src") || "", pageUrl);
  if (!imageUrl || isPlaceholder(imageUrl)) return null;
  const scrollX = image.ownerDocument.defaultView?.scrollX ?? 0;
  const scrollY = image.ownerDocument.defaultView?.scrollY ?? 0;
  return {
    domIndex,
    surfaceId: `surface:${stableUrlPart(imageUrl)}`,
    element: image,
    imageUrl,
    rect: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
    naturalSize,
  };
}

function isMainMangaImage(rect: DOMRect | { width: number; height: number }, naturalSize: Size): boolean {
  const hasRenderedSize = rect.width >= 1 && rect.height >= 1;
  const width = hasRenderedSize ? rect.width : naturalSize.width;
  const height = hasRenderedSize ? rect.height : naturalSize.height;
  return width >= 500 && height >= 600 && height / Math.max(1, width) >= 0.7;
}

function absoluteImageUrl(value: string, pageUrl: string): string {
  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return "";
  }
}

function stableUrlPart(url: string): string {
  return url;
}

function isPlaceholder(url: string): boolean {
  return /placeholder|blank|spacer|loading|transparent|1x1/i.test(url) || url.startsWith("data:image/gif");
}
