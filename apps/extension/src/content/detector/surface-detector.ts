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

function rectFromElement(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function sizeScore(rect: Rect): number {
  let score = 0;
  if (rect.width >= 300 && rect.height >= 300) score += 4;
  if (rect.height / Math.max(rect.width, 1) >= 1.1) score += 3;
  if (rect.width >= 600) score += 1;
  return score;
}

function urlScore(url: string): number {
  return /manga|comic|chapter|page|webtoon|reader/i.test(url) ? 2 : 0;
}

function scoreImage(img: HTMLImageElement, rect: Rect): number {
  return sizeScore(rect) + urlScore(img.currentSrc || img.src);
}

function scoreGenericSurface(rect: Rect, url = ""): number {
  return sizeScore(rect) + urlScore(url);
}

function absoluteUrl(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function extractBackgroundUrl(backgroundImage: string, base: string): string | null {
  const match = /url\(["']?([^"')]+)["']?\)/i.exec(backgroundImage);
  if (!match?.[1] || match[1].startsWith("data:")) return match?.[1] ?? null;
  return absoluteUrl(match[1], base);
}

function detectImgSurfaces(root: Document): DetectedSurface[] {
  return [...root.querySelectorAll<HTMLImageElement>("img")]
    .map((img, index) => {
      const rect = rectFromElement(img);
      const imageUrl = img.currentSrc || img.src;
      const naturalSize = { width: img.naturalWidth || Number(img.width) || rect.width, height: img.naturalHeight || Number(img.height) || rect.height };
      return { surfaceId: `img:${index}:${imageUrl}`, kind: "image" as const, element: img, imageUrl, rect, naturalSize, score: scoreImage(img, rect) };
    })
    .filter((surface) => surface.score >= 6 && Boolean(surface.imageUrl));
}

function detectBackgroundSurfaces(root: Document): DetectedSurface[] {
  const view = root.defaultView;
  if (!view) return [];
  return [...root.querySelectorAll<HTMLElement>("body *")]
    .map((element, index) => {
      const rect = rectFromElement(element);
      const styleBackground = element.style.backgroundImage;
      const computedBackground = view.getComputedStyle(element).backgroundImage;
      const imageUrl = extractBackgroundUrl(styleBackground && styleBackground !== "none" ? styleBackground : computedBackground, root.location.href);
      const naturalSize = { width: rect.width, height: rect.height };
      return { surfaceId: `background:${index}:${imageUrl ?? ""}`, kind: "background" as const, element, ...(imageUrl ? { imageUrl } : {}), rect, naturalSize, score: scoreGenericSurface(rect, imageUrl ?? "") };
    })
    .filter((surface) => surface.score >= 6 && Boolean(surface.imageUrl));
}

function detectCanvasSurfaces(root: Document): DetectedSurface[] {
  return [...root.querySelectorAll<HTMLCanvasElement>("canvas")]
    .map((canvas, index) => {
      const rect = rectFromElement(canvas);
      let imageData: string | undefined;
      try {
        imageData = canvas.toDataURL("image/png");
      } catch {
        imageData = undefined;
      }
      const naturalSize = { width: canvas.width || rect.width, height: canvas.height || rect.height };
      return { surfaceId: `canvas:${index}:${naturalSize.width}x${naturalSize.height}`, kind: "canvas" as const, element: canvas, ...(imageData ? { imageData } : {}), rect, naturalSize, score: scoreGenericSurface(rect) };
    })
    .filter((surface) => surface.score >= 6 && Boolean(surface.imageData));
}

export function detectImageSurfaces(root: Document = document): DetectedSurface[] {
  return [...detectImgSurfaces(root), ...detectBackgroundSurfaces(root), ...detectCanvasSurfaces(root)];
}
