import { clampRectToBounds, mapNaturalBoxToRenderedBox } from "@umt/shared/geometry";
import type { ManualOverridePayload } from "@umt/shared/protocol";
import type { OverlayRegion, Size, SurfaceResult } from "@umt/shared/types";
import { DEFAULT_SETTINGS, normalizeOverlayAppearance, type OverlayAppearance } from "../../settings/settings.js";
import { mergeRenderableRegions, rectFromStyle, rectsOverlapSignificantly, type RenderedRect } from "./overlay-geometry.js";
import { overlayHostForElement } from "./overlay-host.js";
import { maskPaddingForBox, maskStyleForRegion } from "./overlay-mask.js";
import { createStableTextLayout, normalizeOverlayText } from "./text-layout.js";

const manualEdits = new Map<string, string>();

interface RenderState {
  element: HTMLElement;
  naturalSize: Size;
  result: SurfaceResult;
}

export interface OverlayRendererOptions {
  targetLanguage?: string;
  onManualEdit?: (override: ManualOverridePayload) => void;
  appearance?: Partial<OverlayAppearance>;
  replaceExistingRoot?: boolean;
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

export function clearManualEdits(): void {
  manualEdits.clear();
}

export class OverlayRenderer {
  private readonly roots = new Map<HTMLElement, HTMLDivElement>();
  private readonly rendered = new Map<string, RenderState>();
  private readonly manualSelectionProtection = new Map<string, RenderedRect[]>();
  private readonly targetLanguage: string;
  private readonly onManualEdit: ((override: ManualOverridePayload) => void) | undefined;
  private appearance: OverlayAppearance;
  private visible = true;

  constructor(options: OverlayRendererOptions = {}) {
    this.targetLanguage = options.targetLanguage ?? "zh-CN";
    this.onManualEdit = options.onManualEdit;
    this.appearance = normalizeOverlayAppearance(options.appearance ?? DEFAULT_SETTINGS.overlayAppearance);
    if (options.replaceExistingRoot) {
      for (const node of [...document.querySelectorAll("[data-umt-overlay-root='true']")]) node.remove();
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const root of this.roots.values()) root.style.display = visible ? "block" : "none";
  }

  clearSurface(surfaceId: string): void {
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(surfaceId) : surfaceId.replace(/'/g, "\\'");
    for (const root of this.roots.values()) {
      for (const node of [...root.querySelectorAll(`[data-umt-surface-id='${escaped}']`)]) node.remove();
    }
    this.rendered.delete(surfaceId);
    this.manualSelectionProtection.delete(surfaceId);
  }

  clearAll(): void {
    for (const root of this.roots.values()) root.remove();
    this.roots.clear();
    this.rendered.clear();
    this.manualSelectionProtection.clear();
    clearManualEdits();
    this.setVisible(false);
  }

  render(element: HTMLElement, naturalSize: Size, result: SurfaceResult): void {
    this.setVisible(true);
    this.rendered.set(result.surfaceId, { element, naturalSize, result });
    this.renderSurface(element, naturalSize, result);
  }

  refreshAll(): void {
    for (const { element, naturalSize, result } of this.rendered.values()) this.renderSurface(element, naturalSize, result);
  }

  /** Re-renders only manual-selection surfaces so their anchors track scrolling and layout shifts. */
  refreshManualSelections(): void {
    for (const [surfaceId, { element, naturalSize, result }] of this.rendered) {
      if (isManualSelectionSurface(surfaceId)) this.renderSurface(element, naturalSize, result);
    }
  }

  setAppearance(appearance: Partial<OverlayAppearance>): void {
    this.appearance = normalizeOverlayAppearance(appearance);
    this.refreshAll();
  }

  private renderSurface(element: HTMLElement, naturalSize: Size, result: SurfaceResult): void {
    const host = overlayHostForElement(element);
    const root = this.rootForHost(host);
    const rect = element.getBoundingClientRect();
    const hostRect = host === document.documentElement ? null : host.getBoundingClientRect();
    const renderedRect = hostRect
      ? { x: rect.x - hostRect.x + host.scrollLeft, y: rect.y - hostRect.y + host.scrollTop, width: rect.width, height: rect.height }
      : { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height };
    const seenRegionIds = new Set<string>();
    const isManualSelection = isManualSelectionSurface(result.surfaceId);
    const currentManualBoxes: RenderedRect[] = [];
    const renderRegions = mergeRenderableRegions(result.regions);
    for (const region of renderRegions) {
      const clampedNaturalBox = clampRectToBounds(region.box, naturalSize);
      if (!clampedNaturalBox) continue;
      const manualEdit = loadManualEdit(result.imageHash, this.targetLanguage, region.id);
      if (manualEdit === "") continue;
      const textNaturalBox = expandRectWithinBounds(clampedNaturalBox, naturalSize, 1);
      const maskNaturalBox = expandRectWithinBounds(clampedNaturalBox, naturalSize, this.appearance.maskScale);
      const textBox = mapNaturalBoxToRenderedBox(textNaturalBox, naturalSize, renderedRect);
      const box = mapNaturalBoxToRenderedBox(maskNaturalBox, naturalSize, renderedRect);
      if (isManualSelection) {
        currentManualBoxes.push(box);
      } else if (this.overlapsManualSelection(box)) {
        continue;
      }
      seenRegionIds.add(region.id);
      const node = this.findOrCreateRegionNode(root, result.surfaceId, region.id);
      node.dataset.umtSurfaceId = result.surfaceId;
      node.dataset.umtRegionId = region.id;
      node.dataset.umtManualSelection = isManualSelection ? "true" : "false";
      const chip = this.findOrCreateTextChip(node);
      chip.dataset.umtTextChip = "true";
      const padding = maskPaddingForBox(textBox.width, textBox.height, 1);
      const rawText = manualEdit ?? region.translatedText;
      const text = normalizeOverlayText(rawText);
      const initialInnerWidth = Math.max(1, textBox.width - padding * 2);
      const initialInnerHeight = Math.max(1, textBox.height - padding * 2);
      const stableLayout = createStableTextLayout(text, initialInnerWidth, initialInnerHeight, region.style.fontSize, region.kind);
      const initialFontSize = stableLayout.fontSize;
      const glyphInset = glyphSafeInsetForText(text, textBox.width, textBox.height, initialFontSize);
      const innerWidth = Math.max(1, textBox.width - padding * 2 - glyphInset * 2);
      const innerHeight = Math.max(1, textBox.height - padding * 2 - glyphInset * 2);
      const finalLayout = glyphInset > 0 ? createStableTextLayout(text, innerWidth, innerHeight, region.style.fontSize, region.kind) : stableLayout;
      const fittedFontSize = Math.max(8, Math.min(72, Math.round(finalLayout.fontSize * this.appearance.fontScale)));
      const finalDisplayText = finalLayout.text;
      const layoutKey = [
        text,
        finalDisplayText,
        fittedFontSize,
        Math.round(innerWidth),
        Math.round(innerHeight),
        region.style.writingMode,
        region.kind,
      ].join("|");
      const maskStyle = maskStyleForRegion(region.kind, box.width, box.height, this.appearance);
      const nodeStyle = [
        "position:absolute",
        `left:${roundCssPx(box.x)}px`,
        `top:${roundCssPx(box.y)}px`,
        `width:${roundCssPx(box.width)}px`,
        `height:${roundCssPx(box.height)}px`,
        `background:${maskStyle.background}`,
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "box-sizing:border-box",
        `padding:${padding}px`,
        `border-radius:${maskStyle.borderRadius}`,
        `clip-path:${maskStyle.clipPath}`,
        `opacity:${this.appearance.opacity}`,
        "overflow:hidden",
        "pointer-events:none",
      ].join(";");
      if (node.dataset.umtStyleKey !== nodeStyle) {
        node.style.cssText = nodeStyle;
        node.dataset.umtStyleKey = nodeStyle;
      }
      const chipStyle = [
        "display:block",
        "box-sizing:border-box",
        "width:100%",
        "min-width:0",
        "min-height:0",
        "max-width:100%",
        `max-height:${glyphInset > 0 ? "none" : "100%"}`,
        `padding:${glyphInset}px`,
        "border-radius:0",
        `font:${fittedFontSize}px/1.18 system-ui,sans-serif`,
        `font-size:${fittedFontSize}px`,
        `writing-mode:${region.style.writingMode}`,
        "background:transparent",
        `color:${region.style.color}`,
        `text-align:${region.style.align}`,
        `text-shadow:${maskStyle.textShadow}`,
        "white-space:pre",
        "overflow-wrap:anywhere",
        "word-break:break-word",
        "line-break:anywhere",
        `overflow:${glyphInset > 0 ? "visible" : "hidden"}`,
        "pointer-events:auto",
      ].join(";");
      if (chip.dataset.umtLayoutKey !== layoutKey) {
        if (chip.textContent !== finalDisplayText) chip.textContent = finalDisplayText;
        chip.dataset.umtLayoutKey = layoutKey;
      }
      if (chip.dataset.umtStyleKey !== chipStyle) {
        chip.style.cssText = chipStyle;
        chip.dataset.umtStyleKey = chipStyle;
      }
      chip.onclick = () => {
        const next = window.prompt("Edit translation", chip.textContent ?? "");
        if (next !== null) {
          const normalizedNext = next.trim();
          saveManualEdit(result.imageHash, this.targetLanguage, region.id, normalizedNext);
          this.onManualEdit?.({ imageHash: result.imageHash, targetLanguage: this.targetLanguage, regionId: region.id, translatedText: normalizedNext });
          if (normalizedNext === "") node.remove();
          else {
            delete chip.dataset.umtLayoutKey;
            chip.textContent = normalizedNext;
          }
        }
      };
    }
    if (isManualSelection) {
      this.manualSelectionProtection.set(result.surfaceId, currentManualBoxes);
      this.removeNormalNodesCoveredByManualSelections(currentManualBoxes);
    }
    this.removeStaleRegionNodes(result.surfaceId, seenRegionIds);
  }

  private rootForHost(host: HTMLElement): HTMLDivElement {
    const existing = this.roots.get(host);
    if (existing) return existing;
    const root = document.createElement("div");
    root.dataset.umtOverlayRoot = "true";
    root.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;display:${this.visible ? "block" : "none"};`;
    host.append(root);
    this.roots.set(host, root);
    return root;
  }

  private findOrCreateRegionNode(root: HTMLElement, surfaceId: string, regionId: string): HTMLDivElement {
    const selector = `[data-umt-surface-id='${escapeSelectorValue(surfaceId)}'][data-umt-region-id='${escapeSelectorValue(regionId)}']`;
    const existing = root.querySelector<HTMLDivElement>(selector);
    if (existing) return existing;
    const node = document.createElement("div");
    const chip = document.createElement("span");
    chip.dataset.umtTextChip = "true";
    node.append(chip);
    root.append(node);
    return node;
  }

  private findOrCreateTextChip(node: HTMLElement): HTMLSpanElement {
    const existing = node.querySelector<HTMLSpanElement>("[data-umt-text-chip='true']");
    if (existing) return existing;
    const chip = document.createElement("span");
    chip.dataset.umtTextChip = "true";
    node.append(chip);
    return chip;
  }

  private removeStaleRegionNodes(surfaceId: string, seenRegionIds: Set<string>): void {
    const selector = `[data-umt-surface-id='${escapeSelectorValue(surfaceId)}']`;
    for (const root of this.roots.values()) {
      for (const node of [...root.querySelectorAll<HTMLElement>(selector)]) {
        const regionId = node.dataset.umtRegionId;
        if (!regionId || !seenRegionIds.has(regionId)) node.remove();
      }
    }
  }

  private overlapsManualSelection(box: RenderedRect): boolean {
    for (const protectedBoxes of this.manualSelectionProtection.values()) {
      if (protectedBoxes.some((protectedBox) => rectsOverlapSignificantly(box, protectedBox))) return true;
    }
    return false;
  }

  private removeNormalNodesCoveredByManualSelections(protectedBoxes: RenderedRect[]): void {
    if (!protectedBoxes.length) return;
    for (const root of this.roots.values()) {
      for (const node of [...root.querySelectorAll<HTMLElement>("[data-umt-region-id]")]) {
        if (node.dataset.umtManualSelection === "true" || isManualSelectionSurface(node.dataset.umtSurfaceId ?? "")) continue;
        const box = rectFromStyle(node);
        if (box && protectedBoxes.some((protectedBox) => rectsOverlapSignificantly(box, protectedBox))) node.remove();
      }
    }
  }
}

function isManualSelectionSurface(surfaceId: string): boolean {
  return surfaceId.startsWith("manual:");
}

function glyphSafeInsetForText(text: string, width: number, height: number, fittedFontSize: number): number {
  const hasCjk = /[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(text);
  const explicitLines = text.replace(/\r\n?/g, "\n").split("\n").length;
  const highRiskLargeGlyphs = fittedFontSize >= 34 && (explicitLines >= 2 || height >= 180);
  if (!hasCjk || !highRiskLargeGlyphs || width < 180 || height < 90) return 0;
  return Math.max(2, Math.min(8, Math.round(Math.min(width, height) * 0.018)));
}

function escapeSelectorValue(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/['\\]/g, "\\$&");
}

function roundCssPx(value: number): number {
  return Math.round(value * 10) / 10;
}

function expandRectWithinBounds(rect: { x: number; y: number; width: number; height: number }, bounds: Size, scale = 1): { x: number; y: number; width: number; height: number } {
  const basePadX = Math.max(4, Math.min(18, Math.round(rect.width * 0.08)));
  const basePadY = Math.max(4, Math.min(16, Math.round(rect.height * 0.14)));
  if (scale < 1) {
    const defaultWidth = Math.min(bounds.width, rect.width + basePadX * 2);
    const defaultHeight = Math.min(bounds.height, rect.height + basePadY * 2);
    const lowerBound = 0.2;
    const progressToDefault = Math.max(0, Math.min(1, (scale - lowerBound) / (1 - lowerBound)));
    const minimumWidth = Math.max(10, rect.width * 0.55);
    const minimumHeight = Math.max(8, rect.height * 0.75);
    const width = Math.min(bounds.width, minimumWidth + (defaultWidth - minimumWidth) * progressToDefault);
    const height = Math.min(bounds.height, minimumHeight + (defaultHeight - minimumHeight) * progressToDefault);
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const x = Math.max(0, Math.min(bounds.width - width, centerX - width / 2));
    const y = Math.max(0, Math.min(bounds.height - height, centerY - height / 2));
    return { x, y, width: Math.max(2, width), height: Math.max(2, height) };
  }
  const padX = scale >= 1
    ? Math.min(80, basePadX + Math.round(rect.width * 0.18 * (scale - 1)))
    : Math.max(0, Math.round(basePadX * scale));
  const padY = scale >= 1
    ? Math.min(72, basePadY + Math.round(rect.height * 0.3 * (scale - 1)))
    : Math.max(0, Math.round(basePadY * scale));
  const x1 = Math.max(0, rect.x - padX);
  const y1 = Math.max(0, rect.y - padY);
  const x2 = Math.min(bounds.width, rect.x + rect.width + padX);
  const y2 = Math.min(bounds.height, rect.y + rect.height + padY);
  return { x: x1, y: y1, width: Math.max(2, x2 - x1), height: Math.max(2, y2 - y1) };
}
