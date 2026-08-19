import { clampRectToBounds, mapNaturalBoxToRenderedBox } from "@umt/shared/geometry";
import type { Size, SurfaceResult } from "@umt/shared/types";

export type DebugSurfaceState = "detected" | "submitting" | "completed" | "empty" | "failed" | "fallback";

export class DebugOverlayRenderer {
  private readonly root: HTMLDivElement;
  private enabled = false;

  constructor() {
    this.root = document.createElement("div");
    this.root.dataset.umtDebugRoot = "true";
    this.root.style.cssText = "position:absolute;left:0;top:0;z-index:2147483647;pointer-events:none;font:12px system-ui,sans-serif;";
    document.documentElement.append(this.root);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.style.display = enabled ? "block" : "none";
    if (!enabled) this.clear();
  }

  clear(): void {
    this.root.replaceChildren();
  }

  markSurface(surfaceId: string, element: HTMLElement, state: DebugSurfaceState, label = ""): void {
    if (!this.enabled) return;
    this.removeSurface(surfaceId);
    const rect = renderedElementRect(element);
    const node = document.createElement("div");
    node.dataset.umtDebugSurfaceId = surfaceId;
    node.style.cssText = [
      "position:absolute",
      `left:${rect.x}px`,
      `top:${rect.y}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      `border:2px dashed ${colorForState(state)}`,
      "box-sizing:border-box",
      "background:rgba(59,130,246,.05)",
    ].join(";");
    const badge = document.createElement("div");
    badge.textContent = `UMT ${state}${label ? ` | ${label}` : ""}`;
    badge.style.cssText = `display:inline-block;background:${colorForState(state)};color:white;padding:2px 5px;border-radius:4px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
    node.append(badge);
    this.root.append(node);
  }

  markResult(element: HTMLElement, naturalSize: Size, result: SurfaceResult): void {
    if (!this.enabled) return;
    this.markSurface(result.surfaceId, element, result.status === "completed" || result.status === "cached" ? "completed" : result.status, `${result.regions.length} regions`);
    const renderedRect = renderedElementRect(element);
    for (const region of result.regions) {
      const clampedNaturalBox = clampRectToBounds(region.box, naturalSize);
      if (!clampedNaturalBox) continue;
      const box = mapNaturalBoxToRenderedBox(clampedNaturalBox, naturalSize, renderedRect);
      const node = document.createElement("div");
      node.dataset.umtDebugSurfaceId = result.surfaceId;
      node.dataset.umtDebugRegionId = region.id;
      node.title = `${region.sourceText} -> ${region.translatedText}`;
      node.style.cssText = [
        "position:absolute",
        `left:${box.x}px`,
        `top:${box.y}px`,
        `width:${box.width}px`,
        `height:${box.height}px`,
        "border:2px solid rgba(168,85,247,.95)",
        "background:rgba(168,85,247,.08)",
        "box-sizing:border-box",
      ].join(";");
      // Show OCR source vs translation directly so misreads are visible at a
      // glance (white = OCR source, yellow = translation).
      const source = document.createElement("div");
      source.textContent = region.sourceText;
      source.style.cssText = "color:#fff;background:rgba(0,0,0,.6);padding:1px 3px;font-size:10px;line-height:1.3;word-break:break-all;";
      const translated = document.createElement("div");
      translated.textContent = region.translatedText;
      translated.style.cssText = "color:#fde047;background:rgba(0,0,0,.6);padding:1px 3px;font-size:10px;line-height:1.3;word-break:break-all;";
      node.append(source, translated);
      this.root.append(node);
    }
  }

  private removeSurface(surfaceId: string): void {
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(surfaceId) : surfaceId.replace(/'/g, "\\'");
    for (const node of [...this.root.querySelectorAll(`[data-umt-debug-surface-id='${escaped}']`)]) node.remove();
  }
}

function renderedElementRect(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height };
}

function colorForState(state: DebugSurfaceState): string {
  if (state === "completed") return "#16a34a";
  if (state === "empty") return "#f97316";
  if (state === "failed") return "#dc2626";
  if (state === "fallback") return "#9333ea";
  if (state === "submitting") return "#2563eb";
  return "#0ea5e9";
}
