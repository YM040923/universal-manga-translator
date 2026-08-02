import type { RecognitionReason, RecognitionUnit, Size } from "@umt/shared";

export const MAX_RECOGNITION_UNITS = 256;

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
  const width = positiveSafeInteger(input.naturalSize.width, "naturalSize.width");
  const height = positiveSafeInteger(input.naturalSize.height, "naturalSize.height");
  const maxTileHeight = positiveSafeInteger(input.maxTileHeight, "maxTileHeight");
  if (!Number.isFinite(input.overlapRatio)) throw new Error("overlapRatio must be finite.");
  if (input.overlapRatio < 0 || input.overlapRatio >= 1) throw new Error("overlapRatio must be at least 0 and less than 1.");
  const overlapRatio = input.overlapRatio;
  const overlapPx = height > maxTileHeight
    ? Math.min(maxTileHeight - 1, Math.max(0, Math.round(maxTileHeight * overlapRatio)))
    : 0;
  const step = Math.max(1, maxTileHeight - overlapPx);
  const estimatedUnitCount = height <= maxTileHeight ? 1 : Math.ceil((height - maxTileHeight) / step) + 1;
  if (estimatedUnitCount > MAX_RECOGNITION_UNITS) {
    throw new Error(`Recognition plan would create ${estimatedUnitCount} units; maximum is ${MAX_RECOGNITION_UNITS}.`);
  }
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

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive safe integer.`);
  }
  return value;
}
