import { clampRectToBounds, mapNaturalBoxToRenderedBox } from "@umt/shared/geometry";
import type { ManualOverridePayload } from "@umt/shared/protocol";
import type { OverlayRegion, Size, SurfaceResult } from "@umt/shared/types";
import { DEFAULT_SETTINGS, normalizeOverlayAppearance, type OverlayAppearance } from "../../settings/settings.js";

const manualEdits = new Map<string, string>();

interface RenderState {
  element: HTMLElement;
  naturalSize: Size;
  result: SurfaceResult;
}

interface RenderedRect {
  x: number;
  y: number;
  width: number;
  height: number;
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
  private readonly root: HTMLDivElement;
  private readonly rendered = new Map<string, RenderState>();
  private readonly manualSelectionProtection = new Map<string, RenderedRect[]>();
  private readonly targetLanguage: string;
  private readonly onManualEdit: ((override: ManualOverridePayload) => void) | undefined;
  private appearance: OverlayAppearance;

  constructor(options: OverlayRendererOptions = {}) {
    this.targetLanguage = options.targetLanguage ?? "zh-CN";
    this.onManualEdit = options.onManualEdit;
    this.appearance = normalizeOverlayAppearance(options.appearance ?? DEFAULT_SETTINGS.overlayAppearance);
    if (options.replaceExistingRoot) {
      for (const node of [...document.querySelectorAll("[data-umt-overlay-root='true']")]) node.remove();
    }
    this.root = document.createElement("div");
    this.root.dataset.umtOverlayRoot = "true";
    this.root.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;";
    document.documentElement.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? "block" : "none";
  }

  clearSurface(surfaceId: string): void {
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(surfaceId) : surfaceId.replace(/'/g, "\\'");
    for (const node of [...this.root.querySelectorAll(`[data-umt-surface-id='${escaped}']`)]) node.remove();
    this.rendered.delete(surfaceId);
    this.manualSelectionProtection.delete(surfaceId);
  }

  clearAll(): void {
    this.root.replaceChildren();
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

  setAppearance(appearance: Partial<OverlayAppearance>): void {
    this.appearance = normalizeOverlayAppearance(appearance);
    this.refreshAll();
  }

  private renderSurface(element: HTMLElement, naturalSize: Size, result: SurfaceResult): void {
    const rect = element.getBoundingClientRect();
    const renderedRect = { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height };
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
      const node = this.findOrCreateRegionNode(result.surfaceId, region.id);
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

  private findOrCreateRegionNode(surfaceId: string, regionId: string): HTMLDivElement {
    const selector = `[data-umt-surface-id='${escapeSelectorValue(surfaceId)}'][data-umt-region-id='${escapeSelectorValue(regionId)}']`;
    const existing = this.root.querySelector<HTMLDivElement>(selector);
    if (existing) return existing;
    const node = document.createElement("div");
    const chip = document.createElement("span");
    chip.dataset.umtTextChip = "true";
    node.append(chip);
    this.root.append(node);
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
    for (const node of [...this.root.querySelectorAll<HTMLElement>(selector)]) {
      const regionId = node.dataset.umtRegionId;
      if (!regionId || !seenRegionIds.has(regionId)) node.remove();
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
    for (const node of [...this.root.querySelectorAll<HTMLElement>("[data-umt-region-id]")]) {
      if (node.dataset.umtManualSelection === "true" || isManualSelectionSurface(node.dataset.umtSurfaceId ?? "")) continue;
      const box = rectFromStyle(node);
      if (box && protectedBoxes.some((protectedBox) => rectsOverlapSignificantly(box, protectedBox))) node.remove();
    }
  }
}

function normalizeOverlayText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

function createStableTextLayout(text: string, width: number, height: number, preferred: number, kind: string): { text: string; fontSize: number } {
  const normalized = normalizeOverlayText(text);
  const fontSize = fittedFontSizeForBox(normalized, width, height, preferred, kind);
  if (!looksLikeCjkText(normalized) || normalized.includes("\n")) return { text: normalized, fontSize };
  const aspect = width / Math.max(1, height);
  const shapedWidth = kind === "dialogue"
    ? width * (aspect >= 2.35 ? 0.94 : aspect >= 1.7 ? 0.86 : 0.78)
    : width * 0.9;
  const maxCharsPerLine = Math.max(3, Math.floor(shapedWidth / Math.max(1, fontSize)));
  const desiredLines = desiredLineCount(normalized, maxCharsPerLine, width, height, kind);
  return { text: balanceCjkLines(normalized, desiredLines, maxCharsPerLine), fontSize };
}

function looksLikeCjkText(text: string): boolean {
  const chars = Array.from(text).filter((char) => !/\s/u.test(char));
  if (!chars.length) return false;
  const cjk = chars.filter((char) => /[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(char));
  return cjk.length / chars.length >= 0.45;
}

function desiredLineCount(text: string, maxCharsPerLine: number, width: number, height: number, kind: string): number {
  const chars = Array.from(text.replace(/\s+/g, ""));
  const aspect = width / Math.max(1, height);
  if (kind === "dialogue" && aspect >= 2.35 && chars.length >= 18) return 2;
  const base = Math.max(1, Math.ceil(chars.length / Math.max(1, maxCharsPerLine)));
  const wideDialogueBoost = kind === "dialogue" && aspect >= 1.8 && aspect < 2.35 && chars.length >= 16 ? 1 : 0;
  const roomyBubbleBoost = kind === "dialogue" && aspect < 1.8 && width >= 360 && height >= 150 && chars.length >= 16 ? 1 : 0;
  const maxByHeight = Math.max(1, Math.floor(height / 34));
  return Math.max(1, Math.min(Math.max(base, base + wideDialogueBoost, base + roomyBubbleBoost), maxByHeight, 5));
}

function balanceCjkLines(text: string, desiredLines: number, maxCharsPerLine: number): string {
  const chars = Array.from(text.replace(/\s+/g, ""));
  if (desiredLines <= 1) return text;
  const lines: string[] = [];
  let remaining = chars;
  for (let i = desiredLines; i > 0; i -= 1) {
    if (i === 1) {
      lines.push(remaining.join(""));
      break;
    }
    const ideal = Math.ceil(remaining.length / i);
    let take = Math.min(maxCharsPerLine, Math.max(2, ideal));
    take = adjustBreakForPunctuation(remaining, take);
    lines.push(remaining.slice(0, take).join(""));
    remaining = remaining.slice(take);
  }
  return rebalanceShortTail(lines).join("\n");
}

function adjustBreakForPunctuation(chars: string[], take: number): number {
  const opening = "“‘「『《（([{";
  const closing = "，。、！？：；,.!?)]}”’」』》）";
  const badLineEnd = "，、：；,";
  let next = chars[take] ?? "";
  let previous = chars[take - 1] ?? "";
  while (take > 2 && (closing.includes(next) || badLineEnd.includes(previous))) {
    take -= 1;
    next = chars[take] ?? "";
    previous = chars[take - 1] ?? "";
  }
  while (take < chars.length - 2 && opening.includes(next)) {
    take += 1;
    next = chars[take] ?? "";
  }
  return take;
}

function rebalanceShortTail(lines: string[]): string[] {
  if (lines.length < 2) return lines;
  const result = [...lines];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const current = Array.from(result[i] ?? "");
    const previous = Array.from(result[i - 1] ?? "");
    if (current.length >= 2 || previous.length <= 3) continue;
    result[i] = `${previous.pop() ?? ""}${result[i]}`;
    result[i - 1] = previous.join("");
  }
  return result.filter(Boolean);
}

function mergeRenderableRegions(regions: OverlayRegion[]): OverlayRegion[] {
  const sorted = [...regions].sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));
  const groups: OverlayRegion[][] = [];
  for (const region of sorted) {
    const target = groups.find((group) => shouldMergeRenderableGroup(group, region));
    if (target) target.push(region);
    else groups.push([region]);
  }
  return groups.map((group) => group.length === 1 ? group[0]! : mergeRenderableGroup(group));
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

function unionBox(rects: Array<{ x: number; y: number; width: number; height: number }>): { x: number; y: number; width: number; height: number } {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function rectIntersectionArea(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function rectsOverlapSignificantly(a: RenderedRect, b: RenderedRect): boolean {
  const overlapArea = rectIntersectionArea(a, b);
  if (overlapArea <= 0) return false;
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea > 0 && overlapArea / smallerArea >= 0.12;
}

function rectFromStyle(node: HTMLElement): RenderedRect | null {
  const x = Number.parseFloat(node.style.left);
  const y = Number.parseFloat(node.style.top);
  const width = Number.parseFloat(node.style.width);
  const height = Number.parseFloat(node.style.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
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

function maskPaddingForBox(width: number, height: number, scale = 1): number {
  return Math.max(1, Math.min(24, Math.round(Math.min(width, height) * 0.035 * scale)));
}

function maskStyleForRegion(kind: string, width = 0, height = 0, appearance: OverlayAppearance = DEFAULT_SETTINGS.overlayAppearance): { background: string; borderRadius: string; clipPath: string; textShadow: string } {
  const { maskShape: shape, ellipseX, ellipseY } = appearance;
  const ellipseClip = `ellipse(${ellipseX}% ${ellipseY}% at 50% 50%)`;
  if (shape === "transparent") return { background: "transparent", borderRadius: "0", clipPath: "none", textShadow: "0 1px 2px rgba(255,255,255,0.95),0 -1px 2px rgba(255,255,255,0.95),1px 0 2px rgba(255,255,255,0.95),-1px 0 2px rgba(255,255,255,0.95)" };
  if (kind === "sfx") {
    return {
      background: "rgba(255,255,255,0.28)",
      borderRadius: "14px",
      clipPath: "none",
      textShadow: "0 1px 2px rgba(255,255,255,0.95),0 -1px 2px rgba(255,255,255,0.95),1px 0 2px rgba(255,255,255,0.95),-1px 0 2px rgba(255,255,255,0.95)",
    };
  }
  const aspect = width / Math.max(1, height);
  if (shape === "rounded") return { background: "rgb(255,255,255)", borderRadius: "18px", clipPath: "inset(0 round 18px)", textShadow: "none" };
  if (shape === "ellipse") return { background: "rgb(255,255,255)", borderRadius: "999px", clipPath: ellipseClip, textShadow: "none" };
  if (kind === "dialogue" && aspect >= 2.35 && width >= 360) {
    return {
      background: "rgb(255,255,255)",
      borderRadius: "18px",
      clipPath: "inset(0 round 18px)",
      textShadow: "none",
    };
  }
  return {
    background: "rgb(255,255,255)",
    borderRadius: "999px",
    clipPath: kind === "dialogue" ? ellipseClip : "inset(0 round 14px)",
    textShadow: "none",
  };
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

function fittedFontSizeForBox(text: string, width: number, height: number, preferred: number, kind = "dialogue"): number {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const chars = Array.from(normalized || " ");
  const explicitLines = Math.max(1, normalized.split("\n").length);
  const preferredCap = preferred >= 34 ? preferred : preferred + 12;
  const shortTextBoost = chars.length <= 18 && width >= 220 && height >= 110 ? 42 : 34;
  const lengthCap = chars.length >= 60 ? 28 : chars.length >= 36 ? 32 : shortTextBoost;
  const shallowCap = height < 115 ? 29 : height < 150 && chars.length >= 15 ? 30 : height < 180 && chars.length >= 24 ? 32 : 46;
  const ellipseCap = kind === "dialogue" ? Math.max(28, Math.min(44, Math.round(Math.min(width, height) * 0.24))) : 46;
  const contentCap = chars.length <= 18 && width >= 220 && height >= 110 ? Math.max(preferredCap, shortTextBoost) : Math.min(preferredCap, lengthCap);
  const upper = Math.max(12, Math.min(46, contentCap, shallowCap, ellipseCap));
  for (let size = upper; size >= 12; size -= 1) {
    const metrics = estimateWrappedTextMetrics(normalized, size, kind === "dialogue" ? width * 0.78 : width, explicitLines);
    if (metrics.height <= height * 0.92 && metrics.longestLineWidth <= width * 1.03) return size;
  }
  return 12;
}

function estimateWrappedTextMetrics(text: string, fontSize: number, width: number, explicitLines: number): { height: number; longestLineWidth: number } {
  const lineHeight = fontSize * 1.18;
  let lineCount = 0;
  let longestLineWidth = 0;
  for (const paragraph of (text || " ").split("\n")) {
    const paragraphWidth = estimateTextWidth(paragraph, fontSize);
    const lines = Math.max(1, Math.ceil(paragraphWidth / Math.max(1, width)));
    lineCount += lines;
    longestLineWidth = Math.max(longestLineWidth, Math.min(paragraphWidth, width));
  }
  return { height: Math.max(lineCount, explicitLines) * lineHeight, longestLineWidth };
}

function estimateTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((sum, char) => {
    if (/\s/.test(char)) return sum + fontSize * 0.32;
    if (/[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(char)) return sum + fontSize;
    if (/[A-Z0-9]/.test(char)) return sum + fontSize * 0.68;
    return sum + fontSize * 0.56;
  }, 0);
}







