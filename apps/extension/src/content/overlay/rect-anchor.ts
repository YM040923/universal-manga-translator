import type { Rect } from "@umt/shared/types";

export function createRectOverlayAnchor(rect: Rect): HTMLElement {
  const anchor = document.createElement("div");
  anchor.getBoundingClientRect = () => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => ({}),
  } as DOMRect);
  return anchor;
}
