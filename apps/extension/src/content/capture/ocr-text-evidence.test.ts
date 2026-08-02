import test from "node:test";
import assert from "node:assert/strict";
import {
  OCR_TEXT_EVIDENCE_MAX_EDGE,
  OCR_TEXT_EVIDENCE_MAX_LONG_EDGE,
  OCR_TEXT_EVIDENCE_MAX_PIXEL_AREA,
  analyzeOcrTextEvidencePixels,
  createBrowserOcrTextEvidenceProvider,
  readBrowserOcrTextEvidencePixels,
  type OcrTextEvidencePixelInput,
} from "./ocr-text-evidence.js";

test("analyzeOcrTextEvidencePixels accepts bright glyph-like stroke windows", () => {
  const pixels = solidPixels(128, 128, [248, 248, 248, 255]);
  drawGlyphLikeText(pixels, 22, 34);
  drawGlyphLikeText(pixels, 68, 76);

  const result = analyzeOcrTextEvidencePixels(pixels);

  assert.equal(result.likelyText, true);
  assert.equal(result.candidateWindowCount >= 2, true);
  assert.equal(result.candidateClusterCount >= 1, true);
  assert.equal(result.glyphLikeComponentCount >= 4, true);
  assert.equal(result.edgeDensity > 0, true);
  assert.equal(result.contrast > 0, true);
});

test("analyzeOcrTextEvidencePixels keeps small glyph-like text detectable", () => {
  const pixels = solidPixels(128, 128, [248, 248, 248, 255]);
  drawSmallGlyphLikeText(pixels, 45, 57);

  const result = analyzeOcrTextEvidencePixels(pixels);

  assert.equal(result.likelyText, true);
  assert.equal(result.candidateClusterCount >= 1, true);
  assert.equal(result.glyphLikeComponentCount >= 4, true);
});

test("analyzeOcrTextEvidencePixels deduplicates overlapping windows into one glyph cluster", () => {
  const pixels = solidPixels(128, 128, [248, 248, 248, 255]);
  drawGlyphLikeText(pixels, 40, 48);

  const result = analyzeOcrTextEvidencePixels(pixels);

  assert.equal(result.likelyText, true);
  assert.equal(result.candidateWindowCount > 1, true);
  assert.equal(result.candidateClusterCount, 1);
});

test("analyzeOcrTextEvidencePixels rejects a two-pixel manga panel grid", () => {
  const pixels = solidPixels(128, 128, [248, 248, 248, 255]);
  fillRect(pixels, 63, 0, 2, 128, 24);
  fillRect(pixels, 0, 63, 128, 2, 24);

  assert.equal(analyzeOcrTextEvidencePixels(pixels).likelyText, false);
});

test("analyzeOcrTextEvidencePixels rejects empty outlined rectangles", () => {
  const pixels = solidPixels(128, 128, [248, 248, 248, 255]);
  drawRectOutline(pixels, 18, 22, 38, 30, 2, 24);
  drawRectOutline(pixels, 70, 72, 40, 32, 2, 24);

  assert.equal(analyzeOcrTextEvidencePixels(pixels).likelyText, false);
});

test("analyzeOcrTextEvidencePixels rejects sparse diagonal lines", () => {
  const pixels = solidPixels(128, 128, [248, 248, 248, 255]);
  drawDiagonalLine(pixels, 14, 18, 42, 46, 2, 24);
  drawDiagonalLine(pixels, 48, 30, 78, 60, 2, 24);
  drawDiagonalLine(pixels, 78, 66, 112, 100, 2, 24);

  assert.equal(analyzeOcrTextEvidencePixels(pixels).likelyText, false);
});

test("analyzeOcrTextEvidencePixels rejects an empty speech bubble outline", () => {
  const pixels = solidPixels(128, 128, [248, 248, 248, 255]);
  drawEllipseOutline(pixels, 64, 62, 44, 29, 2, 24);

  assert.equal(analyzeOcrTextEvidencePixels(pixels).likelyText, false);
});

test("analyzeOcrTextEvidencePixels rejects flat white and black images", () => {
  for (const value of [0, 255]) {
    const result = analyzeOcrTextEvidencePixels(solidPixels(96, 96, [value, value, value, 255]));
    assert.equal(result.likelyText, false, String(value));
    assert.equal(result.candidateWindowCount, 0, String(value));
  }
});

test("analyzeOcrTextEvidencePixels rejects smooth gradients", () => {
  const pixels = createPixels(128, 128, (x) => {
    const value = Math.round(40 + x / 127 * 180);
    return [value, value, value, 255];
  });

  const result = analyzeOcrTextEvidencePixels(pixels);

  assert.equal(result.likelyText, false);
  assert.equal(result.candidateWindowCount, 0);
});

test("analyzeOcrTextEvidencePixels rejects high-frequency checkerboards and noise", () => {
  const checkerboard = createPixels(128, 128, (x, y) => {
    const value = (x + y) % 2 === 0 ? 20 : 240;
    return [value, value, value, 255];
  });
  let seed = 0x12345678;
  const noise = createPixels(128, 128, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const value = seed & 0xff;
    return [value, value, value, 255];
  });

  for (const pixels of [checkerboard, noise]) {
    const result = analyzeOcrTextEvidencePixels(pixels);
    assert.equal(result.likelyText, false);
    assert.equal(result.edgeDensity > OCR_TEXT_EVIDENCE_MAX_EDGE, true);
  }
});

test("analyzeOcrTextEvidencePixels rejects a colorful complex scene", () => {
  const pixels = createPixels(128, 128, (x, y) => {
    if (y < 48) return [40 + x, 100 + Math.floor(x / 3), 180 + Math.floor(x / 4), 255];
    if (y < 88) return [30 + Math.floor(x / 4), 120 + (x % 40), 40 + Math.floor(y / 4), 255];
    return [(x * 11 + y * 3) % 180, (x * 7 + y * 5) % 170, (x * 5 + y * 9) % 160, 255];
  });

  const result = analyzeOcrTextEvidencePixels(pixels);

  assert.equal(result.likelyText, false);
});

test("analyzeOcrTextEvidencePixels rejects a low-frequency grayscale complex scene", () => {
  const pixels = createPixels(128, 128, (x, y) => {
    const block = (Math.floor(x / 16) * 37 + Math.floor(y / 16) * 53) % 150;
    const diagonal = Math.abs(x - y) < 5 ? 35 : 0;
    const value = Math.max(0, Math.min(255, 55 + block - diagonal));
    return [value, value, value, 255];
  });

  assert.equal(analyzeOcrTextEvidencePixels(pixels).likelyText, false);
});

test("browser OCR evidence provider uses bounded pixels and safely degrades failures to false", async () => {
  const fixture = solidPixels(128, 128, [248, 248, 248, 255]);
  drawGlyphLikeText(fixture, 22, 34);
  drawGlyphLikeText(fixture, 68, 76);
  let reads = 0;
  const provider = createBrowserOcrTextEvidenceProvider({
    readPixels: async (input) => {
      reads += 1;
      assert.equal(input.imageBytes.byteLength, 3);
      return fixture;
    },
  });

  const positive = await provider({
    imageBytes: new Uint8Array([1, 2, 3]),
    imageSize: { width: 1200, height: 800 },
    recognitionUnit: unit(),
  });
  const failed = await createBrowserOcrTextEvidenceProvider({
    readPixels: async () => { throw new Error("decode failed"); },
  })({
    imageBytes: new Uint8Array([1]),
    imageSize: { width: 100, height: 100 },
    recognitionUnit: unit(),
  });

  assert.equal(reads, 1);
  assert.equal(positive.likelyText, true);
  assert.equal(failed.likelyText, false);
  assert.deepEqual(failed, {
    likelyText: false,
    edgeDensity: 0,
    contrast: 0,
    candidateWindowCount: 0,
    candidateClusterCount: 0,
    glyphLikeComponentCount: 0,
  });
  assert.equal(OCR_TEXT_EVIDENCE_MAX_LONG_EDGE, 256);
  assert.equal(OCR_TEXT_EVIDENCE_MAX_PIXEL_AREA, 256 * 256);
});

test("browser OCR evidence pixel reader downsamples and releases canvas and decoded image", async () => {
  const originalDocument = globalThis.document;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  let closed = 0;
  let canvasWidthAfter = -1;
  let canvasHeightAfter = -1;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: "",
      fillRect: () => {},
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      drawImage: () => {},
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
    }),
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => canvas },
  });
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({ width: 1000, height: 500, close: () => { closed += 1; } }),
  });
  try {
    const result = await readBrowserOcrTextEvidencePixels({
      imageBytes: new Uint8Array([1, 2, 3]),
      imageSize: { width: 1000, height: 500 },
      recognitionUnit: unit(),
    });
    canvasWidthAfter = canvas.width;
    canvasHeightAfter = canvas.height;
    assert.deepEqual({ width: result.width, height: result.height }, { width: 256, height: 128 });
    assert.equal(result.data.length, 256 * 128 * 4);
  } finally {
    restoreGlobal("document", originalDocument);
    restoreGlobal("createImageBitmap", originalCreateImageBitmap);
  }
  assert.equal(closed, 1);
  assert.equal(canvasWidthAfter, 0);
  assert.equal(canvasHeightAfter, 0);
});

function solidPixels(width: number, height: number, rgba: [number, number, number, number]): OcrTextEvidencePixelInput {
  return createPixels(width, height, () => rgba);
}

function unit() {
  return {
    id: "full",
    parentSurfaceId: "surface",
    crop: { x: 0, y: 0, width: 1200, height: 800 },
    naturalSize: { width: 1200, height: 800 },
    pixelSize: { width: 1200, height: 800 },
    scaleX: 1,
    scaleY: 1,
    priority: "p0" as const,
    reason: "automatic" as const,
    preprocessingVersion: "none-v1",
  };
}

function restoreGlobal(name: "document" | "createImageBitmap", value: unknown): void {
  if (value === undefined) delete (globalThis as Record<string, unknown>)[name];
  else Object.defineProperty(globalThis, name, { configurable: true, value });
}

function createPixels(
  width: number,
  height: number,
  read: (x: number, y: number) => [number, number, number, number],
): OcrTextEvidencePixelInput {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rgba = read(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = rgba[0];
      data[offset + 1] = rgba[1];
      data[offset + 2] = rgba[2];
      data[offset + 3] = rgba[3];
    }
  }
  return { width, height, data };
}

function drawGlyphLikeText(pixels: OcrTextEvidencePixelInput, startX: number, startY: number): void {
  for (let glyph = 0; glyph < 4; glyph += 1) {
    const x = startX + glyph * 9;
    fillRect(pixels, x, startY, 3, 22, 24);
    fillRect(pixels, x, startY, 7, 3, 24);
    fillRect(pixels, x, startY + 10, 6, 3, 24);
  }
}

function drawSmallGlyphLikeText(pixels: OcrTextEvidencePixelInput, startX: number, startY: number): void {
  for (let glyph = 0; glyph < 4; glyph += 1) {
    const x = startX + glyph * 6;
    fillRect(pixels, x, startY, 2, 10, 24);
    fillRect(pixels, x, startY, 5, 2, 24);
    fillRect(pixels, x, startY + 5, 4, 2, 24);
  }
}

function drawRectOutline(
  pixels: OcrTextEvidencePixelInput,
  x: number,
  y: number,
  width: number,
  height: number,
  thickness: number,
  value: number,
): void {
  fillRect(pixels, x, y, width, thickness, value);
  fillRect(pixels, x, y + height - thickness, width, thickness, value);
  fillRect(pixels, x, y, thickness, height, value);
  fillRect(pixels, x + width - thickness, y, thickness, height, value);
}

function drawDiagonalLine(
  pixels: OcrTextEvidencePixelInput,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  thickness: number,
  value: number,
): void {
  const steps = Math.max(Math.abs(endX - startX), Math.abs(endY - startY));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(startX + (endX - startX) * step / steps);
    const y = Math.round(startY + (endY - startY) * step / steps);
    fillRect(pixels, x, y, thickness, thickness, value);
  }
}

function drawEllipseOutline(
  pixels: OcrTextEvidencePixelInput,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  thickness: number,
  value: number,
): void {
  for (let y = centerY - radiusY - thickness; y <= centerY + radiusY + thickness; y += 1) {
    for (let x = centerX - radiusX - thickness; x <= centerX + radiusX + thickness; x += 1) {
      const distance = ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2;
      if (Math.abs(distance - 1) <= thickness / Math.min(radiusX, radiusY)) {
        fillRect(pixels, x, y, 1, 1, value);
      }
    }
  }
}

function fillRect(pixels: OcrTextEvidencePixelInput, x: number, y: number, width: number, height: number, value: number): void {
  for (let row = y; row < Math.min(pixels.height, y + height); row += 1) {
    for (let column = x; column < Math.min(pixels.width, x + width); column += 1) {
      const offset = (row * pixels.width + column) * 4;
      pixels.data[offset] = value;
      pixels.data[offset + 1] = value;
      pixels.data[offset + 2] = value;
      pixels.data[offset + 3] = 255;
    }
  }
}
