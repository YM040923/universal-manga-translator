import type { Rect, Size } from "@umt/shared/types";

export interface DetectedSurface {
  surfaceId: string;
  element: HTMLImageElement;
  imageUrl: string;
  rect: Rect;
  naturalSize: Size;
  score: number;
}

function rectFromElement(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function scoreImage(img: HTMLImageElement, rect: Rect): number {
  let score = 0;
  if (rect.width >= 300 && rect.height >= 300) score += 4;
  if (rect.height / Math.max(rect.width, 1) >= 1.1) score += 3;
  if (/manga|comic|chapter|page|webtoon|reader/i.test(img.currentSrc || img.src)) score += 2;
  if (rect.width >= 600) score += 1;
  return score;
}

export function detectImageSurfaces(root: Document = document): DetectedSurface[] {
  return [...root.querySelectorAll<HTMLImageElement>("img")]
    .map((img, index) => {
      const rect = rectFromElement(img);
      const imageUrl = img.currentSrc || img.src;
      const naturalSize = { width: img.naturalWidth || Number(img.width) || rect.width, height: img.naturalHeight || Number(img.height) || rect.height };
      return { surfaceId: `img:${index}:${imageUrl}`, element: img, imageUrl, rect, naturalSize, score: scoreImage(img, rect) };
    })
    .filter((surface) => surface.score >= 6 && surface.imageUrl.length > 0);
}

