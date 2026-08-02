export interface RenderedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectIntersectionArea(a: RenderedRect, b: RenderedRect): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

export function rectsOverlapSignificantly(a: RenderedRect, b: RenderedRect): boolean {
  const overlapArea = rectIntersectionArea(a, b);
  if (overlapArea <= 0) return false;
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea > 0 && overlapArea / smallerArea >= 0.12;
}

export function rectFromStyle(node: HTMLElement): RenderedRect | null {
  const x = Number.parseFloat(node.style.left);
  const y = Number.parseFloat(node.style.top);
  const width = Number.parseFloat(node.style.width);
  const height = Number.parseFloat(node.style.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}
