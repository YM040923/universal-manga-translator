import type { Rect } from "@umt/shared/types";

export interface SelectionAnchor {
  element: HTMLElement;
  contentRect: Rect;
}

const UMT_OWNED_SELECTOR = [
  "[data-umt-overlay-root]",
  "[data-umt-text-chip]",
  "[data-umt-region-id]",
  "[data-umt-panel]",
  "[data-umt-selection-layer]",
  "[data-umt-selection-box]",
  "[data-umt-chapter-progress]",
  "[data-umt-surface-button]",
  "[data-umt-floating-button]",
  "[data-umt-floating-menu]",
].join(",");

/**
 * Resolves the DOM element that the manual selection rect sits on top of, and
 * expresses the rect in that element's content coordinate space. The returned
 * anchor element can be tracked across scrolling and layout shifts so the
 * translated overlay lands on the same content the user selected, even when
 * the reader uses an internal scroll container or lazy-loads images.
 */
export function resolveSelectionContentAnchor(rect: Rect): SelectionAnchor {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  let element = document.elementFromPoint(centerX, centerY) as HTMLElement | null;
  while (element && element !== document.documentElement && element.matches?.(UMT_OWNED_SELECTOR)) {
    element = element.parentElement;
  }
  if (!element || element === document.documentElement) element = document.body;
  const anchor = nearestUnderlyingImage(element) ?? element;
  const anchorRect = anchor.getBoundingClientRect();
  return {
    element: anchor,
    contentRect: {
      x: rect.x - anchorRect.x + anchor.scrollLeft,
      y: rect.y - anchorRect.y + anchor.scrollTop,
      width: rect.width,
      height: rect.height,
    },
  };
}

function nearestUnderlyingImage(element: HTMLElement): HTMLImageElement | null {
  let node: HTMLElement | null = element;
  while (node && node !== document.documentElement) {
    if (node.tagName === "IMG" && (node as HTMLImageElement).naturalWidth > 0) return node as HTMLImageElement;
    node = node.parentElement;
  }
  return null;
}
