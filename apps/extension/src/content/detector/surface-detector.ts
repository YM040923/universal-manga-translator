import type { Rect, Size } from "@umt/shared/types";

export type SurfaceKind = "image" | "background" | "canvas" | "screenshot";

export interface DetectedSurface {
  surfaceId: string;
  kind: SurfaceKind;
  element: HTMLElement;
  imageUrl?: string;
  imageData?: string;
  rect: Rect;
  naturalSize: Size;
  score: number;
}

/**
 * Per-element extraction shared by the runtime scanner in ../surface/surface-registry.ts.
 *
 * Canvas and background detection used to live in a parallel `detectImageSurfaces` here whose only
 * caller was its own test file, so both branches stayed green while production scanned nothing but
 * `document.images`. Traversal and acceptance thresholds belong in the scanner; this module must
 * stay free of its own entry point.
 */

export function rectFromElement(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

export function absoluteUrl(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export function isPlaceholderImageUrl(url: string): boolean {
  return /placeholder|blank|spacer|loading|lazy|transparent|1x1/i.test(url) || url.startsWith("data:image/gif");
}

/**
 * Lazy readers keep the real page in a data attribute or in `srcset` and paint a placeholder into
 * `src`, so the attribute order below decides whether a page is readable at all.
 */
export function extractImageElementUrl(img: HTMLImageElement): string {
  const base = img.ownerDocument.location.href;
  for (const attr of ["data-src", "data-original", "data-lazy-src", "data-url", "data-image", "data-cfsrc"]) {
    const value = img.getAttribute(attr);
    if (value && !isPlaceholderImageUrl(value)) return absoluteUrl(value, base);
  }
  const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset");
  const srcsetUrl = srcset ? pickBestSrcsetUrl(srcset, base) : "";
  if (srcsetUrl && !isPlaceholderImageUrl(srcsetUrl)) return srcsetUrl;
  const src = img.currentSrc || img.src || img.getAttribute("src") || "";
  return src ? absoluteUrl(src, base) : "";
}

export function extractBackgroundImageUrl(backgroundImage: string, base: string): string {
  if (!backgroundImage || backgroundImage === "none") return "";
  const match = /url\(["']?([^"')]+)["']?\)/i.exec(backgroundImage);
  if (!match?.[1] || isPlaceholderImageUrl(match[1])) return "";
  return absoluteUrl(match[1], base);
}

/** A canvas that drew cross-origin pixels taints its context, so `toDataURL` throws. */
export function canvasDataUrl(canvas: HTMLCanvasElement): string {
  try {
    const url = canvas.toDataURL("image/png");
    return url && url.length > "data:image/png;base64,".length ? url : "";
  } catch {
    return "";
  }
}

function pickBestSrcsetUrl(srcset: string, base: string): string {
  const candidates = srcset.split(",")
    .map((part) => part.trim())
    .map((part) => {
      const [url = "", descriptor = ""] = part.split(/\s+/, 2);
      const width = Number(/^(\d+)w$/.exec(descriptor)?.[1] ?? 0);
      const density = Number(/^(\d+(?:\.\d+)?)x$/.exec(descriptor)?.[1] ?? 0);
      return { url, rank: width || density || 1 };
    })
    .filter((candidate) => candidate.url && !isPlaceholderImageUrl(candidate.url));
  candidates.sort((a, b) => b.rank - a.rank);
  return candidates[0] ? absoluteUrl(candidates[0].url, base) : "";
}
