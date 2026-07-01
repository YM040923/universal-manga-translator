import type { Rect, Size } from "./types.js";

export function mapNaturalBoxToRenderedBox(box: Rect, naturalSize: Size, renderedRect: Rect): Rect {
  const scaleX = renderedRect.width / naturalSize.width;
  const scaleY = renderedRect.height / naturalSize.height;
  return { x: renderedRect.x + box.x * scaleX, y: renderedRect.y + box.y * scaleY, width: box.width * scaleX, height: box.height * scaleY };
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return x2 > x1 && y2 > y1 ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null;
}

export function area(rect: Rect): number { return Math.max(0, rect.width) * Math.max(0, rect.height); }

export function visibleRatio(subject: Rect, viewport: Rect): number {
  const subjectArea = area(subject);
  if (subjectArea === 0) return 0;
  const overlap = intersectRect(subject, viewport);
  return overlap ? area(overlap) / subjectArea : 0;
}


export function clampRectToBounds(rect: Rect, bounds: Size): Rect | null {
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
  if (rect.width <= 0 || rect.height <= 0 || bounds.width <= 0 || bounds.height <= 0) return null;
  const x1 = Math.max(0, Math.min(bounds.width, rect.x));
  const y1 = Math.max(0, Math.min(bounds.height, rect.y));
  const x2 = Math.max(x1, Math.min(bounds.width, rect.x + rect.width));
  const y2 = Math.max(y1, Math.min(bounds.height, rect.y + rect.height));
  const clamped = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  return isUsableRect(clamped) ? clamped : null;
}

export function isUsableRect(rect: Rect, minSize = 2): boolean {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width >= minSize && rect.height >= minSize;
}
