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

