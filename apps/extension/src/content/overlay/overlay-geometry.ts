import type { OverlayRegion } from "@umt/shared/types";

export interface RenderedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function mergeRenderableRegions(regions: OverlayRegion[]): OverlayRegion[] {
  const sorted = [...regions].sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));
  const groups: OverlayRegion[][] = [];
  for (const region of sorted) {
    const target = groups.find((group) => shouldMergeRenderableGroup(group, region));
    if (target) target.push(region);
    else groups.push([region]);
  }
  return groups.map((group) => group.length === 1 ? group[0]! : mergeRenderableGroup(group));
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

function shouldMergeRenderableGroup(group: OverlayRegion[], next: OverlayRegion): boolean {
  const first = group[0]!;
  if (first.kind === "sfx" || next.kind === "sfx") return false;
  if (first.kind !== next.kind || first.orientation !== next.orientation) return false;
  if (first.style.writingMode !== next.style.writingMode) return false;
  const union = unionBox(group.map((region) => region.box));
  const overlapArea = rectIntersectionArea(union, next.box);
  const smallerArea = Math.min(union.width * union.height, next.box.width * next.box.height);
  if (smallerArea > 0 && overlapArea / smallerArea >= 0.12) return true;
  const merged = unionBox([...group.map((region) => region.box), next.box]);
  const centerDistance = Math.abs((union.x + union.width / 2) - (next.box.x + next.box.width / 2));
  const verticalGap = Math.max(0, next.box.y - (union.y + union.height));
  const averageHeight = (union.height + next.box.height) / 2;
  return verticalGap <= Math.max(18, averageHeight * 0.32)
    && centerDistance <= Math.max(merged.width * 0.22, 80)
    && merged.height <= Math.max(620, averageHeight * 2.7);
}

function mergeRenderableGroup(group: OverlayRegion[]): OverlayRegion {
  const box = unionBox(group.map((region) => region.box));
  const first = group[0]!;
  return {
    ...first,
    id: group.map((region) => region.id).join("+"),
    box,
    sourceText: group.map((region) => region.sourceText.trim()).filter(Boolean).join("\n"),
    translatedText: group.map((region) => region.translatedText.trim()).filter(Boolean).join("\n"),
    confidence: group.reduce((sum, region) => sum + region.confidence, 0) / group.length,
    style: { ...first.style, fontSize: Math.max(...group.map((region) => region.style.fontSize)) },
  };
}

function unionBox(rects: RenderedRect[]): RenderedRect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
