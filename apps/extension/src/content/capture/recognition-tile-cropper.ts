import type { RecognitionUnit, Rect } from "@umt/shared";

export interface CroppedRecognitionTile {
  unit: RecognitionUnit;
  imageData: string;
  imageBytes: Uint8Array;
  mimeType: "image/png";
}

export type RecognitionTilePngRenderer = (fullImageData: string, crop: Rect) => Promise<string>;
export type RecognitionTileCropper = (fullImageData: string, units: RecognitionUnit[]) => Promise<CroppedRecognitionTile[]>;

export async function cropRecognitionTiles(
  fullImageData: string,
  units: RecognitionUnit[],
  renderPngCrop?: RecognitionTilePngRenderer,
): Promise<CroppedRecognitionTile[]> {
  const image = renderPngCrop ? undefined : await loadImage(fullImageData);
  const tiles: CroppedRecognitionTile[] = [];
  for (const unit of units) {
    const imageData = renderPngCrop
      ? await renderPngCrop(fullImageData, unit.crop)
      : cropLoadedImageToPng(image!, unit.crop);
    if (!imageData.startsWith("data:image/png;base64,")) throw new Error("Recognition tile cropper must return a base64 PNG data URL.");
    tiles.push({
      unit,
      imageData,
      imageBytes: base64DataUrlToBytes(imageData),
      mimeType: "image/png",
    });
  }
  return tiles;
}

function cropLoadedImageToPng(image: HTMLImageElement, crop: Rect): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load recognition source image"));
    image.src = dataUrl;
  });
}

function base64DataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Invalid recognition tile data URL.");
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
