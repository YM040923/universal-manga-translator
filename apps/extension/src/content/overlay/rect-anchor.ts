import type { Rect } from "@umt/shared/types";

export function createRectOverlayAnchor(rect: Rect): HTMLElement {
  return createDocumentRectOverlayAnchor({
    x: rect.x + window.scrollX,
    y: rect.y + window.scrollY,
    width: rect.width,
    height: rect.height,
  });
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

/**
 * Creates an overlay anchor that tracks a real DOM element instead of a fixed
 * document coordinate. `contentRect` is the selected rect expressed in the
 * element's content coordinate space (element box origin + its own scroll
 * offsets). The anchor re-derives the current viewport position live from the
 * element, so it stays correct across window scrolling, inner scroll
 * containers, and layout shifts caused by lazy-loaded images.
 */
export function createElementTrackingOverlayAnchor(element: HTMLElement, contentRect: Rect): HTMLElement {
  const anchor = document.createElement("div");
  anchor.dataset.umtTrackingAnchor = "true";
  anchor.getBoundingClientRect = () => {
    const elementRect = element.getBoundingClientRect();
    const x = elementRect.x + (contentRect.x - element.scrollLeft);
    const y = elementRect.y + (contentRect.y - element.scrollTop);
    return {
      x,
      y,
      width: contentRect.width,
      height: contentRect.height,
      top: y,
      left: x,
      right: x + contentRect.width,
      bottom: y + contentRect.height,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return anchor;
}
