import type { OverlayRegion, OverlayStyle, Rect, SurfaceResult, TextRegion } from "@umt/shared/types";

const MAX_REGIONS = 500;
const MAX_TEXT_CHARS = 4000;
const MAX_IDENTIFIER_CHARS = 200;
const MAX_COORDINATE = 1_000_000;
const DEFAULT_BACKGROUND = "rgba(255,255,255,0.86)";
const DEFAULT_COLOR = "#111827";

const WRITING_MODES = new Set<OverlayStyle["writingMode"]>(["horizontal-tb", "vertical-rl"]);
const TEXT_ALIGNS = new Set<OverlayStyle["align"]>(["left", "center", "right"]);
const ORIENTATIONS = new Set<TextRegion["orientation"]>(["horizontal", "vertical", "unknown"]);
const REGION_KINDS = new Set<TextRegion["kind"]>(["dialogue", "narration", "sfx", "unknown"]);
const STATUSES = new Set<SurfaceResult["status"]>(["cached", "completed", "empty"]);
/** One CSS value token: colors, hex values, or a bare keyword. Never a list, url(), or braces. */
const SAFE_CSS_VALUE = /^(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([\d\s.,%/]+\)|[a-zA-Z]{3,20})$/;

/**
 * Results reach the page from a remote OCR + translator pair, the local backend,
 * or extension storage, so nothing in them is trusted. The overlay renderer
 * writes `style.cssText`, which interpolates region styles directly.
 */
export function sanitizeSurfaceResult(result: SurfaceResult | undefined): SurfaceResult | undefined {
  if (!result || typeof result !== "object") return undefined;
  if (!STATUSES.has(result.status) || !Array.isArray(result.regions)) return undefined;
  return {
    ...result,
    surfaceId: safeText(result.surfaceId, MAX_IDENTIFIER_CHARS),
    imageHash: safeText(result.imageHash, MAX_IDENTIFIER_CHARS),
    providerProfile: safeText(result.providerProfile, MAX_IDENTIFIER_CHARS),
    regions: renderableRegions(result.regions),
  };
}

/** The purified result, or `undefined` when nothing in it can be drawn. */
export function renderableSurfaceResult(result: SurfaceResult | undefined): SurfaceResult | undefined {
  const sanitized = sanitizeSurfaceResult(result);
  if (!sanitized || sanitized.status === "empty" || !sanitized.regions.length) return undefined;
  return sanitized;
}

function renderableRegions(regions: unknown): OverlayRegion[] {
  return (Array.isArray(regions) ? regions : []).slice(0, MAX_REGIONS).map(sanitizeRegion).filter((region): region is OverlayRegion => region !== undefined);
}

function sanitizeRegion(value: unknown): OverlayRegion | undefined {
  if (!value || typeof value !== "object") return undefined;
  const region = value as unknown as Partial<OverlayRegion>;
  const id = safeText(region.id, MAX_IDENTIFIER_CHARS);
  const box = sanitizeRect(region.box);
  if (!id || !box) return undefined;
  return {
    id,
    box,
    sourceText: safeText(region.sourceText, MAX_TEXT_CHARS),
    translatedText: safeText(region.translatedText, MAX_TEXT_CHARS),
    confidence: safeNumber(region.confidence, 0, 1, 1),
    orientation: pick(region.orientation, ORIENTATIONS, "unknown"),
    kind: pick(region.kind, REGION_KINDS, "dialogue"),
    style: sanitizeStyle(region.style),
  };
}

function sanitizeStyle(value: unknown): OverlayStyle {
  const style = (value && typeof value === "object" ? value : {}) as Partial<OverlayStyle>;
  return {
    fontSize: safeNumber(style.fontSize, 6, 200, 16),
    writingMode: pick(style.writingMode, WRITING_MODES, "horizontal-tb"),
    align: pick(style.align, TEXT_ALIGNS, "center"),
    background: safeCssValue(style.background, DEFAULT_BACKGROUND),
    color: safeCssValue(style.color, DEFAULT_COLOR),
  };
}

function sanitizeRect(value: unknown): Rect | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rect = value as Partial<Rect>;
  const values = [rect.x, rect.y, rect.width, rect.height].map((coordinate) => (typeof coordinate === "number" && Number.isFinite(coordinate) ? clamp(coordinate) : undefined));
  const [x, y, width, height] = values as [number | undefined, number | undefined, number | undefined, number | undefined];
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function safeText(value: unknown, maxChars: number): string {
  return typeof value === "string" ? value.slice(0, maxChars) : "";
}

function safeNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clamp(value: number): number {
  return Math.round(Math.min(MAX_COORDINATE, Math.max(-MAX_COORDINATE, value)));
}

function pick<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : fallback;
}

function safeCssValue(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return SAFE_CSS_VALUE.test(candidate) ? candidate : fallback;
}
