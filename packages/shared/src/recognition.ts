import type { Rect, Size } from "./types.js";

export type RecognitionReason = "automatic" | "manual-selection" | "ocr-rescue";

export interface RecognitionUnit {
  id: string;
  parentSurfaceId: string;
  imageHash?: string;
  crop: Rect;
  naturalSize: Size;
  pixelSize: Size;
  scaleX: number;
  scaleY: number;
  priority: "p0" | "p1" | "p2";
  reason: RecognitionReason;
  preprocessingVersion: string;
}

export interface OcrObservation {
  id: string;
  unitId: string;
  box: Rect;
  sourceText: string;
  confidence: number;
  orientation: "horizontal" | "vertical";
  kind: "dialogue" | "narration" | "sfx";
  variant: string;
  suspicious: boolean;
}
