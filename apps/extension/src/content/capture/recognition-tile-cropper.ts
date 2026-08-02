import type { RecognitionUnit, Rect } from "@umt/shared";

export interface CroppedRecognitionTile {
  unit: RecognitionUnit;
  imageBytes: Uint8Array;
  mimeType: "image/png";
}

export type RecognitionTileConsumer = (tile: CroppedRecognitionTile, index: number, tileCount: number) => Promise<void>;
export type RecognitionTilePngRenderer = (fullImageData: string, crop: Rect) => Promise<Uint8Array>;
export type RecognitionTileCropper = (
  fullImageData: string,
  units: RecognitionUnit[],
  consume: RecognitionTileConsumer,
) => Promise<void>;

const RELEASED_TILE_BYTES = new Uint8Array(0);

export async function cropRecognitionTiles(
  fullImageData: string,
  units: RecognitionUnit[],
  consume: RecognitionTileConsumer,
  renderPngCrop?: RecognitionTilePngRenderer,
): Promise<void> {
  let image: HTMLImageElement | undefined;
  try {
    if (!renderPngCrop) image = await loadImage(fullImageData);
    for (const [index, unit] of units.entries()) {
      const imageBytes = renderPngCrop
        ? await renderPngCrop(fullImageData, unit.crop)
        : await cropLoadedImageToPngBytes(image!, unit.crop);
      const tile: CroppedRecognitionTile = { unit, imageBytes, mimeType: "image/png" };
      try {
        await consume(tile, index, units.length);
      } finally {
        tile.imageBytes = RELEASED_TILE_BYTES;
      }
    }
  } finally {
    if (image) image.src = "";
    image = undefined;
  }
}

async function cropLoadedImageToPngBytes(image: HTMLImageElement, crop: Rect): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode recognition tile as PNG"));
    }, "image/png");
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load recognition source image"));
    image.src = dataUrl;
  });
}
