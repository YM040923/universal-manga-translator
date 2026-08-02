import type {
  BubbleOwnershipEvidence,
  BubbleShape,
  GenericOcrImageInput,
  GenericOcrRegion,
} from "@umt/core";
import type { Rect } from "@umt/shared";

export interface BubbleEvidenceExtractionInput extends GenericOcrImageInput {
  width: number;
  height: number;
  observations: readonly GenericOcrRegion[];
}

export interface BubbleEvidencePixels {
  width: number;
  height: number;
  grayscale: Uint8Array;
  release(): void;
}

export type BubbleEvidencePixelDecoder = (
  input: BubbleEvidenceExtractionInput,
) => Promise<BubbleEvidencePixels>;

export type BrowserBubbleEvidenceExtractor = (
  input: BubbleEvidenceExtractionInput,
) => Promise<BubbleOwnershipEvidence[]>;

export interface BrowserBubbleEvidenceExtractorOptions {
  decoder?: BubbleEvidencePixelDecoder;
}

interface PixelWindow {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Component {
  polarity: "bright" | "dark";
  box: Rect;
  area: number;
  fillRatio: number;
  touchesBoundary: boolean;
  confidence: number;
  shape: BubbleShape;
}

const MAX_LOCAL_COMPONENT_PIXELS = 1_000_000;

export function createBrowserBubbleEvidenceExtractor(
  options: BrowserBubbleEvidenceExtractorOptions = {},
): BrowserBubbleEvidenceExtractor {
  const decoder = options.decoder ?? decodeBrowserBubblePixels;
  return async (input) => {
    if (input.observations.length === 0) return [];
    const pixels = await decoder(input);
    try {
      return input.observations.map((observation) => evidenceForObservation(pixels, observation));
    } finally {
      pixels.release();
    }
  };
}

function evidenceForObservation(
  pixels: BubbleEvidencePixels,
  observation: GenericOcrRegion,
): BubbleOwnershipEvidence {
  const component = findBestComponent(pixels, observation.box);
  if (!component || component.touchesBoundary || component.confidence < 0.72) {
    return {
      observationId: observation.id,
      ...(component ? { componentBox: component.box } : {}),
      shape: "free-text",
      confidence: Math.min(0.45, component?.confidence ?? 0.2),
      touchesBoundary: component?.touchesBoundary ?? true,
    };
  }
  return {
    observationId: observation.id,
    visualGroupId: componentGroupId(component),
    componentBox: component.box,
    shape: component.shape,
    confidence: component.confidence,
    touchesBoundary: false,
  };
}

function findBestComponent(pixels: BubbleEvidencePixels, observationBox: Rect): Component | null {
  const windows = localSearchWindows(pixels, observationBox);
  let best: Component | null = null;
  for (const window of windows) {
    if ((window.right - window.left) * (window.bottom - window.top) > MAX_LOCAL_COMPONENT_PIXELS) break;
    const candidates = candidateComponents(pixels, observationBox, window);
    for (const candidate of candidates) {
      if (!best || candidate.confidence > best.confidence) best = candidate;
    }
    if (best && !best.touchesBoundary && best.confidence >= 0.72) return best;
  }
  return best;
}

function localSearchWindows(pixels: BubbleEvidencePixels, box: Rect): PixelWindow[] {
  const initialPadX = Math.max(96, box.width * 1.25);
  const initialPadY = Math.max(140, box.height * 6);
  const scales = [1, 1.75, 2.75];
  const windows: PixelWindow[] = [];
  for (const scale of scales) {
    const window = {
      left: Math.max(0, Math.floor(box.x - initialPadX * scale)),
      top: Math.max(0, Math.floor(box.y - initialPadY * scale)),
      right: Math.min(pixels.width, Math.ceil(box.x + box.width + initialPadX * scale)),
      bottom: Math.min(pixels.height, Math.ceil(box.y + box.height + initialPadY * scale)),
    };
    const previous = windows.at(-1);
    if (!previous || !sameWindow(previous, window)) windows.push(window);
  }
  return windows;
}

function candidateComponents(
  pixels: BubbleEvidencePixels,
  observationBox: Rect,
  window: PixelWindow,
): Component[] {
  const candidates: Component[] = [];
  const scanned: Component[] = [];
  const seenSeeds = new Set<number>();
  for (const [x, y] of seedPoints(observationBox)) {
    const pixelX = clampInteger(x, window.left, window.right - 1);
    const pixelY = clampInteger(y, window.top, window.bottom - 1);
    const index = pixelY * pixels.width + pixelX;
    if (seenSeeds.has(index)) continue;
    seenSeeds.add(index);
    const value = pixels.grayscale[index]!;
    if (value >= 205 && !scanned.some((component) => component.polarity === "bright" && pointInsideRect(pixelX, pixelY, component.box))) {
      const component = floodComponent(pixels, pixelX, pixelY, window, "bright");
      if (component) {
        scanned.push(component);
        if (isReasonableComponent(component, observationBox)) candidates.push(component);
      }
    }
    if (value <= 50 && !scanned.some((component) => component.polarity === "dark" && pointInsideRect(pixelX, pixelY, component.box))) {
      const component = floodComponent(pixels, pixelX, pixelY, window, "dark");
      if (component) {
        scanned.push(component);
        if (isReasonableComponent(component, observationBox)) candidates.push(component);
      }
    }
  }
  return dedupeComponents(candidates);
}

function seedPoints(box: Rect): Array<[number, number]> {
  const left = box.x;
  const right = box.x + box.width - 1;
  const top = box.y;
  const bottom = box.y + box.height - 1;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const insetX = Math.max(2, box.width * 0.12);
  const insetY = Math.max(2, box.height * 0.18);
  return [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
    [centerX, top],
    [centerX, bottom],
    [left, centerY],
    [right, centerY],
    [left + insetX, top + insetY],
    [right - insetX, top + insetY],
    [left + insetX, bottom - insetY],
    [right - insetX, bottom - insetY],
    [centerX, centerY - insetY],
    [centerX, centerY + insetY],
  ];
}

function floodComponent(
  pixels: BubbleEvidencePixels,
  seedX: number,
  seedY: number,
  window: PixelWindow,
  polarity: Component["polarity"],
): Component | null {
  const windowWidth = window.right - window.left;
  const windowHeight = window.bottom - window.top;
  if (windowWidth <= 0 || windowHeight <= 0) return null;
  const visited = new Uint8Array(windowWidth * windowHeight);
  const queueX = new Int32Array(windowWidth * windowHeight);
  const queueY = new Int32Array(windowWidth * windowHeight);
  let head = 0;
  let tail = 0;
  queueX[tail] = seedX;
  queueY[tail] = seedY;
  tail += 1;
  visited[(seedY - window.top) * windowWidth + seedX - window.left] = 1;
  let minX = seedX;
  let minY = seedY;
  let maxX = seedX;
  let maxY = seedY;
  let area = 0;
  let touchesBoundary = false;

  while (head < tail) {
    const x = queueX[head]!;
    const y = queueY[head]!;
    head += 1;
    if (!matchesPolarity(pixels.grayscale[y * pixels.width + x]!, polarity)) continue;
    area += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (
      x === window.left
      || y === window.top
      || x === window.right - 1
      || y === window.bottom - 1
      || x === 0
      || y === 0
      || x === pixels.width - 1
      || y === pixels.height - 1
    ) {
      touchesBoundary = true;
    }
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  if (area <= 0) return null;
  const rawBox = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const box = expandRect(rawBox, pixels.width, pixels.height, 3);
  const fillRatio = area / Math.max(1, rawBox.width * rawBox.height);
  const shape = classifyShape(fillRatio, rawBox);
  const confidence = componentConfidence(area, fillRatio, rawBox, touchesBoundary);
  return { polarity, box, area, fillRatio, touchesBoundary, confidence, shape };

  function enqueue(x: number, y: number): void {
    if (x < window.left || y < window.top || x >= window.right || y >= window.bottom) return;
    const localIndex = (y - window.top) * windowWidth + x - window.left;
    if (visited[localIndex]) return;
    visited[localIndex] = 1;
    if (!matchesPolarity(pixels.grayscale[y * pixels.width + x]!, polarity)) return;
    queueX[tail] = x;
    queueY[tail] = y;
    tail += 1;
  }
}

function isReasonableComponent(component: Component, observationBox: Rect): boolean {
  const observationArea = observationBox.width * observationBox.height;
  const componentArea = component.box.width * component.box.height;
  if (component.area < observationArea * 1.35) return false;
  if (componentArea > observationArea * 90) return false;
  const aspect = component.box.width / component.box.height;
  if (aspect < 0.18 || aspect > 5.5) return false;
  const centerX = observationBox.x + observationBox.width / 2;
  const centerY = observationBox.y + observationBox.height / 2;
  return centerX >= component.box.x
    && centerX <= component.box.x + component.box.width
    && centerY >= component.box.y
    && centerY <= component.box.y + component.box.height;
}

function componentConfidence(
  area: number,
  fillRatio: number,
  box: Rect,
  touchesBoundary: boolean,
): number {
  if (touchesBoundary) return 0.32;
  const areaScore = Math.min(0.12, Math.log2(Math.max(2, area)) / 100);
  const fillScore = fillRatio >= 0.42 && fillRatio <= 0.98 ? 0.12 : 0.02;
  const aspect = box.width / box.height;
  const aspectScore = aspect >= 0.25 && aspect <= 4 ? 0.08 : 0.02;
  return Math.min(0.96, 0.65 + areaScore + fillScore + aspectScore);
}

function classifyShape(fillRatio: number, box: Rect): BubbleShape {
  const aspect = box.width / box.height;
  if (fillRatio >= 0.42 && fillRatio <= 0.84 && aspect >= 0.28 && aspect <= 3.6) return "ellipse";
  if (fillRatio <= 0.96) return "rounded-rect";
  return "rect";
}

function componentGroupId(component: Component): string {
  const { x, y, width, height } = component.box;
  return `component:${component.polarity}:${x}:${y}:${width}:${height}`;
}

function dedupeComponents(components: Component[]): Component[] {
  const seen = new Set<string>();
  return components.filter((component) => {
    const key = componentGroupId(component);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchesPolarity(value: number, polarity: Component["polarity"]): boolean {
  return polarity === "bright" ? value >= 205 : value <= 50;
}

function expandRect(box: Rect, width: number, height: number, padding: number): Rect {
  const left = Math.max(0, box.x - padding);
  const top = Math.max(0, box.y - padding);
  const right = Math.min(width, box.x + box.width + padding);
  const bottom = Math.min(height, box.y + box.height + padding);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function sameWindow(left: PixelWindow, right: PixelWindow): boolean {
  return left.left === right.left
    && left.top === right.top
    && left.right === right.right
    && left.bottom === right.bottom;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

async function decodeBrowserBubblePixels(
  input: BubbleEvidenceExtractionInput,
): Promise<BubbleEvidencePixels> {
  if (typeof document === "undefined") throw new Error("Browser document is unavailable");
  const decoded = await decodeImage(input.imageBytes, input.mimeType);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(input.width));
  canvas.height = Math.max(1, Math.round(input.height));
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const grayscale = new Uint8Array(canvas.width * canvas.height);
    for (let index = 0, pixel = 0; index < rgba.length; index += 4, pixel += 1) {
      grayscale[pixel] = Math.round(
        rgba[index]! * 0.299
        + rgba[index + 1]! * 0.587
        + rgba[index + 2]! * 0.114,
      );
    }
    let released = false;
    return {
      width: canvas.width,
      height: canvas.height,
      grayscale,
      release: () => {
        if (released) return;
        released = true;
        canvas.width = 0;
        canvas.height = 0;
        decoded.release();
      },
    };
  } catch (error) {
    canvas.width = 0;
    canvas.height = 0;
    decoded.release();
    throw error;
  }
}

interface DecodedImage {
  image: CanvasImageSource;
  release(): void;
}

async function decodeImage(bytes: Uint8Array, mimeType = "application/octet-stream"): Promise<DecodedImage> {
  const blob = new Blob([uint8ArrayToArrayBuffer(bytes)], { type: mimeType });
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { image: bitmap, release: () => bitmap.close() };
  }
  if (typeof Image === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Browser image decoding is unavailable");
  }
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Failed to decode bubble evidence image bytes"));
      image.src = objectUrl;
    });
    return {
      image,
      release: () => {
        image.src = "";
        URL.revokeObjectURL(objectUrl);
      },
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function uint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function pointInsideRect(x: number, y: number, box: Rect): boolean {
  return x >= box.x
    && x < box.x + box.width
    && y >= box.y
    && y < box.y + box.height;
}
