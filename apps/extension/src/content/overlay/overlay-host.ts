export function overlayHostForElement(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (!style) continue;
    if (createsOverlayCoordinateSpace(node, style)) {
      ensureOverlayHostStyle(node, style);
      return node;
    }
  }
  return document.documentElement;
}

function createsOverlayCoordinateSpace(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  const scrollsVertically = /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 2;
  const scrollsHorizontally = /(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 2;
  const transformed = style.transform !== "none" || style.perspective !== "none" || style.filter !== "none" || style.backdropFilter !== "none";
  const contained = style.contain !== "none" || style.contentVisibility === "auto";
  return scrollsVertically || scrollsHorizontally || transformed || contained;
}

function ensureOverlayHostStyle(element: HTMLElement, style: CSSStyleDeclaration): void {
  if (style.position === "static") element.style.position = "relative";
}
