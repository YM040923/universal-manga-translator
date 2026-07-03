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

export function isLikelyReaderPage(root: Document = document, surfaces: RegisteredSurface[] = SurfaceRegistry.scan(root).surfaces): boolean {
  if (looksLikeChapterUrl(root.location.href)) return true;
  if (surfaces.length >= 2 && looksLikeStackedReaderSurfaces(surfaces)) return true;
  if (surfaces.length === 1) {
    const surface = surfaces[0]!;
    const rect = surface.rect;
    const viewportWidth = root.defaultView?.innerWidth ?? rect.width;
    const isTallPage = rect.height >= Math.max(1200, rect.width * 1.8);
    const fillsReaderColumn = rect.width >= Math.min(700, viewportWidth * 0.55);
    return isTallPage && fillsReaderColumn && looksLikeChapterImageUrl(surface.imageUrl);
  }
  return false;
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

function looksLikeChapterUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /(?:^|\/)(chapter|chap|episode|ep|read|reader)(?:\/|-|_|$)|\/\d+(?:\/)?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function looksLikeChapterImageUrl(url: string): boolean {
  return /(?:chapter|chap|episode|ep|page|pages|reader|webtoon|manga|comics?)|\/\d+\/[^/]+\.(?:webp|jpe?g|png)(?:$|\?)/i.test(url);
}

function looksLikeStackedReaderSurfaces(surfaces: RegisteredSurface[]): boolean {
  const sorted = [...surfaces].sort((a, b) => a.rect.y - b.rect.y);
  const readerLike = sorted.filter((surface) => surface.rect.width >= 500 && surface.rect.height >= 600 && looksLikeChapterImageUrl(surface.imageUrl));
  if (readerLike.length < 2) return false;
  let stackedPairs = 0;
  for (let i = 1; i < readerLike.length; i += 1) {
    const previous = readerLike[i - 1]!;
    const current = readerLike[i]!;
    const horizontalCenterDistance = Math.abs((previous.rect.x + previous.rect.width / 2) - (current.rect.x + current.rect.width / 2));
    const sameReaderColumn = horizontalCenterDistance <= Math.max(120, Math.min(previous.rect.width, current.rect.width) * 0.35);
    const verticalGap = current.rect.y - (previous.rect.y + previous.rect.height);
    if (sameReaderColumn && verticalGap >= -40 && verticalGap <= 420) stackedPairs += 1;
  }
  return stackedPairs >= 1;
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
