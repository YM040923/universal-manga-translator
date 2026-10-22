import type { Rect, Size } from "@umt/shared/types";
import {
  canvasDataUrl,
  extractBackgroundImageUrl,
  extractImageElementUrl,
  isPlaceholderImageUrl,
  rectFromElement,
} from "../detector/surface-detector.js";

export type RegisteredSurfaceKind = "image" | "background" | "canvas";

export interface RegisteredSurface {
  index: number;
  surfaceId: string;
  element: HTMLElement;
  kind: RegisteredSurfaceKind;
  imageUrl?: string;
  /** Canvases carry their pixels here because they have no URL to fetch. */
  imageData?: string;
  /** Chapter cache identity: the page URL when there is one, otherwise the surface's own id. */
  cacheKey: string;
  rect: Rect;
  naturalSize: Size;
}

/** A portrait page: at least this wide and tall, and taller than it is wide by a sane margin. */
const MIN_PORTRAIT_WIDTH = 500;
const MIN_PORTRAIT_HEIGHT = 600;
/** A landscape spread holds two pages side by side, so it is wide first and only moderately tall. */
const MIN_SPREAD_WIDTH = 1200;
const MIN_SPREAD_HEIGHT = 500;

/** Cheap reject: nothing below this can be a page in any layout, so skip the style reads. */
const MIN_EDGE_FOR_DETECTION = 500;

export class SurfaceRegistry {
  readonly surfaces: RegisteredSurface[];

  private constructor(surfaces: RegisteredSurface[]) {
    this.surfaces = surfaces;
  }

  static scan(root: Document = document): SurfaceRegistry {
    const pageUrl = root.location.href;
    const byKey = new Map<string, Omit<RegisteredSurface, "index">>();
    let domIndex = 0;
    for (const element of walkDocument(root)) {
      const surface = toRegisteredCandidate(element, pageUrl, domIndex);
      domIndex += 1;
      if (!surface) continue;
      const current = byKey.get(surface.cacheKey);
      if (current && surfacePreference(surface.kind) >= surfacePreference(current.kind)) continue;
      byKey.set(surface.cacheKey, surface);
    }
    const candidates = [...byKey.values()].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    return new SurfaceRegistry(candidates.map((surface, index) => ({ ...surface, index: index + 1 })));
  }
}

export function isLikelyReaderPage(
  root: Document = document,
  surfaces: RegisteredSurface[] = SurfaceRegistry.scan(root).surfaces,
  options: ReaderPageCheckOptions = {},
): boolean {
  const frameUrl = root.location.href;
  const isTopFrame = options.isTopFrame !== false;
  // A srcdoc or cross-origin reader frame has no useful URL of its own, so it borrows the page URL.
  const inheritsReaderPage = !isTopFrame && looksLikeChapterUrl(options.pageUrl ?? frameUrl);
  if (looksLikeComicDirectoryUrl(frameUrl) && !looksLikeChapterUrl(frameUrl)) return false;
  if (looksLikeChapterUrl(frameUrl)) return true;
  if (surfaces.length >= 2 && looksLikeStackedReaderSurfaces(surfaces)) return true;
  if (surfaces.length === 1) {
    const surface = surfaces[0]!;
    const rect = surface.rect;
    const viewportWidth = root.defaultView?.innerWidth ?? rect.width;
    const fillsReaderColumn = rect.width >= Math.min(700, viewportWidth * 0.55);
    // A canvas painter has no URL evidence at all, so only its geometry can vouch for it.
    const paintedWholePage = surface.kind === "canvas" && rect.height >= Math.max(900, rect.width * 0.9);
    return fillsReaderColumn && (isSpreadPage(rect, surface.naturalSize) || isTallPage(rect, surface.naturalSize) || paintedWholePage) && (hasPageUrlEvidence(surface) || inheritsReaderPage || paintedWholePage);
  }
  return false;
}

export interface ReaderPageCheckOptions {
  /** The tab's top-level URL: an embedded reader frame belongs to the page the reader opened. */
  pageUrl?: string;
  /** Defaults to true — the frame that owns the address bar. */
  isTopFrame?: boolean;
}

/**
 * Yields every element the page can paint, descending into open shadow roots. Closed shadow roots
 * are unreachable by design of the platform, so a reader that uses one needs the force entry.
 */
function* walkDocument(root: Document): Generator<HTMLElement> {
  if (!root.documentElement) return;
  yield* walkElement(root.documentElement);
}

function* walkElement(element: Element): Generator<HTMLElement> {
  yield element as HTMLElement;
  if (element.shadowRoot) {
    for (const child of Array.from(element.shadowRoot.children)) yield* walkElement(child);
  }
  for (const child of Array.from(element.children)) yield* walkElement(child);
}

function toRegisteredCandidate(element: HTMLElement, pageUrl: string, domIndex: number): Omit<RegisteredSurface, "index"> | null {
  const rect = rectFromElement(element);
  if (rect.width < MIN_EDGE_FOR_DETECTION && rect.height < MIN_EDGE_FOR_DETECTION) return null;
  const tagName = element.tagName.toUpperCase();
  if (tagName === "IMG") return imageCandidate(element as unknown as HTMLImageElement, rect, pageUrl);
  if (tagName === "CANVAS") return canvasCandidate(element, rect, pageUrl, domIndex);
  return backgroundCandidate(element, rect, pageUrl);
}

function imageCandidate(img: HTMLImageElement, rect: Rect, pageUrl: string): Omit<RegisteredSurface, "index"> | null {
  const imageUrl = extractImageElementUrl(img);
  if (!imageUrl || isPlaceholderImageUrl(imageUrl)) return null;
  const naturalSize = {
    width: img.naturalWidth || Number(img.width) || Math.round(rect.width),
    height: img.naturalHeight || Number(img.height) || Math.round(rect.height),
  };
  if (!isMangaSizedPage(rect, naturalSize)) return null;
  return { surfaceId: `surface:${imageUrl}`, element: img, kind: "image", imageUrl, cacheKey: imageUrl, rect: withScroll(img.ownerDocument, rect), naturalSize };
}

function canvasCandidate(element: HTMLElement, rect: Rect, pageUrl: string, domIndex: number): Omit<RegisteredSurface, "index"> | null {
  const canvas = element as unknown as HTMLCanvasElement;
  const imageData = canvasDataUrl(canvas);
  if (!imageData) return null;
  const naturalSize = { width: canvas.width || Math.round(rect.width), height: canvas.height || Math.round(rect.height) };
  if (!isMangaSizedPage(rect, naturalSize)) return null;
  // A canvas has no URL, so its identity is the element itself; the id must survive a re-scan or
  // every mutation would reset the queue for the page currently being translated.
  const stableId = stableElementId(canvas, pageUrl, domIndex);
  return { surfaceId: `surface:${stableId}`, element, kind: "canvas", imageData, cacheKey: `surface:${stableId}`, rect: withScroll(element.ownerDocument, rect), naturalSize };
}

function backgroundCandidate(element: HTMLElement, rect: Rect, pageUrl: string): Omit<RegisteredSurface, "index"> | null {
  const view = element.ownerDocument.defaultView;
  const inline = element.style?.backgroundImage ?? "";
  let imageUrl = extractBackgroundImageUrl(inline, pageUrl);
  if (!imageUrl && view) {
    imageUrl = extractBackgroundImageUrl(view.getComputedStyle(element).backgroundImage, pageUrl);
  }
  if (!imageUrl || isPlaceholderImageUrl(imageUrl)) return null;
  const naturalSize = { width: Math.round(rect.width), height: Math.round(rect.height) };
  if (!isMangaSizedPage(rect, naturalSize)) return null;
  return { surfaceId: `surface:${imageUrl}`, element, kind: "background", imageUrl, cacheKey: imageUrl, rect: withScroll(element.ownerDocument, rect), naturalSize };
}

/** The <img> reports real decoded dimensions, so it wins over a wrapper that repeats it as a background. */
function surfacePreference(kind: RegisteredSurfaceKind): number {
  return kind === "image" ? 0 : kind === "canvas" ? 1 : 2;
}

const CANVAS_ELEMENT_IDS = new WeakMap<Element, string>();
let canvasIdSeq = 0;

function stableElementId(element: Element, pageUrl: string, domIndex: number): string {
  const existing = CANVAS_ELEMENT_IDS.get(element);
  if (existing) return existing;
  const created = `${hostnameOf(pageUrl)}:canvas:${(canvasIdSeq += 1)}:${domIndex}`;
  CANVAS_ELEMENT_IDS.set(element, created);
  return created;
}

function hostnameOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname;
  } catch {
    return "page";
  }
}

function withScroll(doc: Document | null, rect: Rect): Rect {
  const view = doc?.defaultView;
  return { x: rect.x + (view?.scrollX ?? 0), y: rect.y + (view?.scrollY ?? 0), width: rect.width, height: rect.height };
}

export function isMangaSizedPage(rect: Rect, naturalSize: Size): boolean {
  const width = rect.width >= 1 && rect.height >= 1 ? rect.width : naturalSize.width;
  const height = rect.width >= 1 && rect.height >= 1 ? rect.height : naturalSize.height;
  return isTallPage({ width, height } as Rect, { width, height }) || isSpreadPage({ width, height } as Rect, { width, height });
}

function isTallPage(rect: Rect, naturalSize: Size): boolean {
  const ratio = rect.height / Math.max(1, rect.width);
  const naturalRatio = naturalSize.height / Math.max(1, naturalSize.width);
  return rect.width >= MIN_PORTRAIT_WIDTH && rect.height >= MIN_PORTRAIT_HEIGHT && (ratio >= 0.7 || naturalRatio >= 0.7);
}

function isSpreadPage(rect: Rect, naturalSize: Size): boolean {
  const ratio = rect.height / Math.max(1, rect.width);
  const naturalRatio = naturalSize.height / Math.max(1, naturalSize.width);
  return rect.width >= MIN_SPREAD_WIDTH && rect.height >= MIN_SPREAD_HEIGHT && ratio >= 0.45 && naturalRatio >= 0.45;
}

function looksLikeComicDirectoryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\/(?:comics?|manga|series)\/[^/]+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function looksLikeChapterUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /(?:^|\/)(chapter|chap|episode|ep|read|reader)(?:\/|-|_|$)|\/\d+(?:\/)?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function looksLikeChapterImageUrl(url: string): boolean {
  return /(?:chapter|chap|episode|ep|page|pages|reader|webtoon|manga|comics?)|\/\d+\/[^/]+\.(?:webp|jpe?g|png)(?:$|\?)/i.test(url);
}

function hasChapterEvidence(surface: RegisteredSurface): boolean {
  if (surface.imageUrl && looksLikeChapterImageUrl(surface.imageUrl)) return true;
  return looksLikeTallReaderPanel(surface);
}

/**
 * One surface alone cannot prove it is a page: a portrait banner passes every size gate. Only a
 * second stacked neighbour, the embedding chapter URL, or a canvas that paints the whole viewport
 * can carry the claim, so a single image must bring its own URL evidence.
 */
function hasPageUrlEvidence(surface: RegisteredSurface): boolean {
  return Boolean(surface.imageUrl && looksLikeChapterImageUrl(surface.imageUrl));
}

function looksLikeStackedReaderSurfaces(surfaces: RegisteredSurface[]): boolean {
  const sorted = [...surfaces].sort((a, b) => a.rect.y - b.rect.y);
  const readerLike = sorted.filter((surface) => isMangaSizedPage(surface.rect, surface.naturalSize) && hasChapterEvidence(surface));
  if (readerLike.length < 2) return false;
  let stackedPairs = 0;
  for (let i = 1; i < readerLike.length; i += 1) {
    const previous = readerLike[i - 1]!;
    const current = readerLike[i]!;
    const horizontalCenterDistance = Math.abs((previous.rect.x + previous.rect.width / 2) - (current.rect.x + current.rect.width / 2));
    const sameReaderColumn = horizontalCenterDistance <= Math.max(120, Math.min(previous.rect.width, current.rect.width) * 0.35);
    const verticalGap = current.rect.y - (previous.rect.y + previous.rect.height);
    if (sameReaderColumn && verticalGap >= -40 && verticalGap <= 420) stackedPairs += 1;
  }
  return stackedPairs >= 1;
}

function looksLikeTallReaderPanel(surface: RegisteredSurface): boolean {
  const aspect = surface.rect.height / Math.max(1, surface.rect.width);
  const naturalAspect = surface.naturalSize.height / Math.max(1, surface.naturalSize.width);
  return aspect >= 1.15 || naturalAspect >= 1.15;
}
