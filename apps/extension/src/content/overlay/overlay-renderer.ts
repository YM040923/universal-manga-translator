import { mapNaturalBoxToRenderedBox } from "@umt/shared/geometry";
import type { ManualOverridePayload } from "@umt/shared/protocol";
import type { Size, SurfaceResult } from "@umt/shared/types";

const manualEdits = new Map<string, string>();

interface RenderState {
  element: HTMLElement;
  naturalSize: Size;
  result: SurfaceResult;
}

export interface OverlayRendererOptions {
  targetLanguage?: string;
  onManualEdit?: (override: ManualOverridePayload) => void;
}

function manualEditKey(imageHash: string, targetLanguage: string, regionId: string): string {
  return `${imageHash}:${targetLanguage}:${regionId}`;
}

export function saveManualEdit(imageHash: string, targetLanguage: string, regionId: string, text: string): void {
  manualEdits.set(manualEditKey(imageHash, targetLanguage, regionId), text);
}

export function loadManualEdit(imageHash: string, targetLanguage: string, regionId: string): string | null {
  return manualEdits.get(manualEditKey(imageHash, targetLanguage, regionId)) ?? null;
}

export class OverlayRenderer {
  private readonly root: HTMLDivElement;
  private readonly rendered = new Map<string, RenderState>();
  private readonly targetLanguage: string;
  private readonly onManualEdit: ((override: ManualOverridePayload) => void) | undefined;

  constructor(options: OverlayRendererOptions = {}) {
    this.targetLanguage = options.targetLanguage ?? "zh-CN";
    this.onManualEdit = options.onManualEdit;
    this.root = document.createElement("div");
    this.root.dataset.umtOverlayRoot = "true";
    this.root.style.cssText = "position:absolute;left:0;top:0;z-index:2147483646;pointer-events:none;";
    document.documentElement.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? "block" : "none";
  }

  clearSurface(surfaceId: string): void {
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(surfaceId) : surfaceId.replace(/'/g, "\\'");
    for (const node of [...this.root.querySelectorAll(`[data-umt-surface-id='${escaped}']`)]) node.remove();
  }

  render(element: HTMLElement, naturalSize: Size, result: SurfaceResult): void {
    this.rendered.set(result.surfaceId, { element, naturalSize, result });
    this.renderSurface(element, naturalSize, result);
  }

  refreshAll(): void {
    for (const { element, naturalSize, result } of this.rendered.values()) this.renderSurface(element, naturalSize, result);
  }

  private renderSurface(element: HTMLElement, naturalSize: Size, result: SurfaceResult): void {
    this.clearSurface(result.surfaceId);
    const rect = element.getBoundingClientRect();
    const renderedRect = { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height };
    for (const region of result.regions) {
      const box = mapNaturalBoxToRenderedBox(region.box, naturalSize, renderedRect);
      const node = document.createElement("div");
      node.dataset.umtSurfaceId = result.surfaceId;
      node.dataset.umtRegionId = region.id;
      node.textContent = loadManualEdit(result.imageHash, this.targetLanguage, region.id) ?? region.translatedText;
      node.style.cssText = [
        "position:absolute",
        `left:${box.x}px`,
        `top:${box.y}px`,
        `width:${box.width}px`,
        `min-height:${box.height}px`,
        `font:${region.style.fontSize}px/1.25 system-ui,sans-serif`,
        `background:${region.style.background}`,
        `color:${region.style.color}`,
        `text-align:${region.style.align}`,
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "box-sizing:border-box",
        "padding:4px",
        "border-radius:6px",
        "white-space:pre-wrap",
        "pointer-events:auto",
      ].join(";");
      node.addEventListener("click", () => {
        const next = window.prompt("Edit translation", node.textContent ?? "");
        if (next !== null) {
          node.textContent = next;
          saveManualEdit(result.imageHash, this.targetLanguage, region.id, next);
          this.onManualEdit?.({ imageHash: result.imageHash, targetLanguage: this.targetLanguage, regionId: region.id, translatedText: next });
        }
      });
      this.root.append(node);
    }
  }
}