import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizeForProvider } from "./normalize.js";

test("normalizeForProvider resizes and converts images to jpeg", async () => {
  const input = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "white" } }).png().toBuffer();
  const result = await normalizeForProvider(input, { maxLongEdge: 1000, jpegQuality: 70 });
  const meta = await sharp(result.buffer).metadata();
  assert.equal(result.mimeType, "image/jpeg");
  assert.equal(meta.width, 1000);
  assert.equal(meta.height, 500);
});
