import type { RecognitionReason, RecognitionUnit, Size } from "@umt/shared";

export interface RecognitionPlan {
  units: RecognitionUnit[];
  overlapPx: number;
}

export interface PlanRecognitionUnitsInput {
  surfaceId: string;
  naturalSize: Size;
  maxTileHeight: number;
  overlapRatio: number;
  reason: RecognitionReason;
  preprocessingVersion?: string;
}

export function planRecognitionUnits(input: PlanRecognitionUnitsInput): RecognitionPlan {
  const width = positiveInteger(input.naturalSize.width, "naturalSize.width");
  const height = positiveInteger(input.naturalSize.height, "naturalSize.height");
  const maxTileHeight = positiveInteger(input.maxTileHeight, "maxTileHeight");
  const overlapRatio = Number.isFinite(input.overlapRatio)
    ? Math.max(0, Math.min(0.95, input.overlapRatio))
    : 0;
  const overlapPx = height > maxTileHeight
    ? Math.min(maxTileHeight - 1, Math.max(0, Math.round(maxTileHeight * overlapRatio)))
    : 0;
  const step = Math.max(1, maxTileHeight - overlapPx);
  const preprocessingVersion = input.preprocessingVersion?.trim() || "none-v1";
  const units: RecognitionUnit[] = [];

  for (let y = 0, index = 0; y < height; y += step, index += 1) {
    const cropHeight = Math.min(maxTileHeight, height - y);
    const crop = { x: 0, y, width, height: cropHeight };
    units.push({
      id: `${input.surfaceId}:${input.reason}:${crop.x},${crop.y},${crop.width}x${crop.height}`,
      parentSurfaceId: input.surfaceId,
      crop,
      naturalSize: { width, height },
      pixelSize: { width: crop.width, height: crop.height },
      scaleX: 1,
      scaleY: 1,
      priority: index === 0 ? "p0" : "p1",
      reason: input.reason,
      preprocessingVersion,
    });
    if (y + cropHeight >= height) break;
  }

  return { units, overlapPx };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and greater than 0.`);
  return Math.max(1, Math.round(value));
}
