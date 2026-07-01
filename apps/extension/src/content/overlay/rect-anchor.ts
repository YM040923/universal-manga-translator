import type { Rect } from "@umt/shared/types";

export function createRectOverlayAnchor(rect: Rect): HTMLElement {
  const anchor = document.createElement("div");
  const documentRect = {
    x: rect.x + window.scrollX,
    y: rect.y + window.scrollY,
    width: rect.width,
    height: rect.height,
  };
  anchor.getBoundingClientRect = () => {
    const x = documentRect.x - window.scrollX;
    const y = documentRect.y - window.scrollY;
    return {
      x,
      y,
      width: documentRect.width,
      height: documentRect.height,
      top: y,
      left: x,
      right: x + documentRect.width,
      bottom: y + documentRect.height,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return anchor;
}
