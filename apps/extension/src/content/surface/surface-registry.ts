import type { Rect, Size } from "@umt/shared/types";
import { detectImageSurfaces, type SurfaceKind } from "../detector/surface-detector.js";

export interface RegisteredSurface {
  index: number;
  surfaceId: string;
  kind?: SurfaceKind;
  element: HTMLElement;
  imageUrl?: string;
  imageData?: string;
  rect: Rect;
  naturalSize: Size;
}

export class SurfaceRegistry {
  readonly surfaces: RegisteredSurface[];

  private constructor(surfaces: RegisteredSurface[]) {
    this.surfaces = surfaces;
  }

  static scan(root: Document = document): SurfaceRegistry {
    const view = root.defaultView;
    const scrollX = view?.scrollX ?? 0;
    const scrollY = view?.scrollY ?? 0;
    const candidates = detectImageSurfaces(root)
      .map((surface, domIndex) => ({
        ...surface,
        domIndex,
        surfaceId: stableSurfaceId(surface.kind, surface.imageUrl, surface.imageData, surface.naturalSize),
        rect: {
          x: surface.rect.x + scrollX,
          y: surface.rect.y + scrollY,
          width: surface.rect.width,
          height: surface.rect.height,
        },
      }))
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.domIndex - b.domIndex);
    return new SurfaceRegistry(candidates.map(({ domIndex: _domIndex, score: _score, ...surface }, index) => ({ ...surface, index: index + 1 })));
  }
}

export function isLikelyReaderPage(root: Document = document, surfaces: RegisteredSurface[] = SurfaceRegistry.scan(root).surfaces): boolean {
  if (looksLikeComicDirectoryUrl(root.location.href) && !looksLikeChapterUrl(root.location.href)) return false;
  if (looksLikeChapterUrl(root.location.href)) return true;
  if (surfaces.length >= 2 && looksLikeStackedReaderSurfaces(surfaces)) return true;
  if (surfaces.length === 1) {
    const surface = surfaces[0]!;
    const rect = surface.rect;
    const viewportWidth = root.defaultView?.innerWidth ?? rect.width;
    const isTallPage = rect.height >= Math.max(1200, rect.width * 1.8);
    const fillsReaderColumn = rect.width >= Math.min(700, viewportWidth * 0.55);
    return isTallPage && fillsReaderColumn && (surface.kind !== "image" || looksLikeChapterImageUrl(surface.imageUrl));
  }
  return false;
}

function stableSurfaceId(kind: SurfaceKind, imageUrl: string | undefined, imageData: string | undefined, naturalSize: Size): string {
  if (imageUrl) return `surface:${kind}:${imageUrl}`;
  const content = imageData ? hashText(imageData) : `${naturalSize.width}x${naturalSize.height}`;
  return `surface:${kind}:${naturalSize.width}x${naturalSize.height}:${content}`;
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function looksLikeComicDirectoryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\/(?:comics?|manga|series)\/[^/]+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function looksLikeChapterUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /(?:^|\/)(chapter|chap|episode|ep|read|reader)(?:\/|-|_|$)|\/\d+(?:\/)?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function looksLikeChapterImageUrl(url: string | undefined): boolean {
  return /(?:chapter|chap|episode|ep|page|pages|reader|webtoon|manga|comics?)|\/\d+\/[^/]+\.(?:webp|jpe?g|png)(?:$|\?)/i.test(url ?? "");
}

function looksLikeStackedReaderSurfaces(surfaces: RegisteredSurface[]): boolean {
  const sorted = [...surfaces].sort((a, b) => a.rect.y - b.rect.y);
  const readerLike = sorted.filter((surface) => surface.rect.width >= 500 && surface.rect.height >= 600 && (looksLikeChapterImageUrl(surface.imageUrl) || looksLikeTallReaderPanel(surface)));
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

function looksLikeTallReaderPanel(surface: RegisteredSurface): boolean {
  const aspect = surface.rect.height / Math.max(1, surface.rect.width);
  const naturalAspect = surface.naturalSize.height / Math.max(1, surface.naturalSize.width);
  return aspect >= 1.15 || naturalAspect >= 1.15;
}
