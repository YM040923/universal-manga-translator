import test from "node:test";
import assert from "node:assert/strict";
import type { RecognitionUnit } from "@umt/shared";
import { cropRecognitionTiles, type CroppedRecognitionTile } from "./recognition-tile-cropper.js";

test("cropRecognitionTiles streams lossless PNG bytes in plan order and releases each tile after consumption", async () => {
  const units = [
    unit("tile-1", 0, 4096),
    unit("tile-2", 3584, 4096),
  ];
  const crops: RecognitionUnit["crop"][] = [];
  const consumed: number[][] = [];
  const retainedTiles: CroppedRecognitionTile[] = [];

  await cropRecognitionTiles(
    "data:image/jpeg;base64,full",
    units,
    async (tile, index, tileCount) => {
      assert.equal(index, consumed.length);
      assert.equal(tileCount, 2);
      assert.equal("imageData" in tile, false);
      consumed.push([...tile.imageBytes]);
      retainedTiles.push(tile);
    },
    async (_imageData, crop) => {
      crops.push(crop);
      return new Uint8Array([crop.y === 0 ? 1 : 2]);
    },
  );

  assert.deepEqual(crops, units.map((item) => item.crop));
  assert.deepEqual(consumed, [[1], [2]]);
  assert.deepEqual(retainedTiles.map((tile) => tile.unit.id), ["tile-1", "tile-2"]);
  assert.deepEqual(retainedTiles.map((tile) => tile.mimeType), ["image/png", "image/png"]);
  assert.deepEqual(retainedTiles.map((tile) => tile.imageBytes.byteLength), [0, 0]);
});

function unit(id: string, y: number, height: number): RecognitionUnit {
  return {
    id,
    parentSurfaceId: "surface:tall",
    crop: { x: 0, y, width: 1000, height },
    naturalSize: { width: 1000, height: 16000 },
    pixelSize: { width: 1000, height },
    scaleX: 1,
    scaleY: 1,
    priority: y === 0 ? "p0" : "p1",
    reason: "automatic",
    preprocessingVersion: "png-tile-v1",
  };
}
