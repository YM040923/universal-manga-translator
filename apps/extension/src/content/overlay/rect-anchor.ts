import type { Rect } from "@umt/shared/types";

/**
 * Converts a viewport selection to document coordinates at the instant the
 * selection completes. Async OCR may finish after the reader has scrolled.
 */
export function documentRectFromViewportRect(rect: Rect): Rect {
  return {
    x: rect.x + window.scrollX,
    y: rect.y + window.scrollY,
    width: rect.width,
    height: rect.height,
  };
}

export function createRectOverlayAnchor(rect: Rect): HTMLElement {
  return createDocumentRectOverlayAnchor(documentRectFromViewportRect(rect));
}

export function createDocumentRectOverlayAnchor(documentRect: Rect): HTMLElement {
  const anchor = document.createElement("div");
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
