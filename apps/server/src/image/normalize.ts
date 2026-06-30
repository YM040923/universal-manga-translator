import sharp from "sharp";

export interface NormalizeOptions {
  maxLongEdge: number;
  jpegQuality: number;
}

export interface NormalizedProviderImage {
  buffer: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

export async function normalizeForProvider(input: Buffer, options: NormalizeOptions = { maxLongEdge: 1600, jpegQuality: 75 }): Promise<NormalizedProviderImage> {
  const metadata = await sharp(input).metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;
  const longEdge = Math.max(width, height);
  const resize = longEdge > options.maxLongEdge ? { width: Math.round((width / longEdge) * options.maxLongEdge), height: Math.round((height / longEdge) * options.maxLongEdge) } : undefined;
  const buffer = await sharp(input).resize(resize).jpeg({ quality: options.jpegQuality }).toBuffer();
  const out = await sharp(buffer).metadata();
  return { buffer, mimeType: "image/jpeg", width: out.width ?? width, height: out.height ?? height };
}
