import test from "node:test";
import assert from "node:assert/strict";
import type { RecognitionUnit } from "@umt/shared";
import { cropRecognitionTiles } from "./recognition-tile-cropper.js";

test("cropRecognitionTiles returns lossless PNG data and bytes in plan order", async () => {
  const units = [
    unit("tile-1", 0, 4096),
    unit("tile-2", 3584, 4096),
  ];
  const crops: RecognitionUnit["crop"][] = [];

  const result = await cropRecognitionTiles(
    "data:image/jpeg;base64,full",
    units,
    async (_imageData, crop) => {
      crops.push(crop);
      return `data:image/png;base64,${crop.y === 0 ? "AQ==" : "Ag=="}`;
    },
  );

  assert.deepEqual(crops, units.map((item) => item.crop));
  assert.deepEqual(result.map((item) => item.unit.id), ["tile-1", "tile-2"]);
  assert.deepEqual(result.map((item) => item.mimeType), ["image/png", "image/png"]);
  assert.deepEqual(result.map((item) => [...item.imageBytes]), [[1], [2]]);
  assert.equal(result.every((item) => item.imageData.startsWith("data:image/png;base64,")), true);
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
