export type Priority = "p0" | "p1" | "p2" | "p3";
export type JobStatus = "queued" | "processing" | "cached" | "completed" | "empty" | "failed" | "skipped" | "cancelled";

export interface Rect { x: number; y: number; width: number; height: number; }
export interface Size { width: number; height: number; }

export interface SurfaceTask {
  surfaceId: string;
  pageUrl: string;
  domain: string;
  imageUrl?: string;
  imageData?: string;
  viewportPriority: Priority;
  surfaceRect: Rect;
  naturalSize: Size;
  renderSize: Size;
  readingDirection: "auto" | "ltr" | "rtl" | "vertical";
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TextRegion {
  id: string;
  box: Rect;
  sourceText: string;
  translatedText: string;
  confidence: number;
  orientation: "horizontal" | "vertical" | "unknown";
  kind: "dialogue" | "narration" | "sfx" | "unknown";
}

export interface OverlayStyle {
  fontSize: number;
  writingMode: "horizontal-tb" | "vertical-rl";
  align: "left" | "center" | "right";
  background: string;
  color: string;
}

export interface OverlayRegion extends TextRegion { style: OverlayStyle; }

export interface SurfaceResult {
  surfaceId: string;
  imageHash: string;
  status: "cached" | "completed" | "empty";
  regions: OverlayRegion[];
  providerProfile: string;
  layoutVersion: number;
  elapsedMs: number;
}

export interface FailedResult {
  surfaceId: string;
  status: "failed";
  recoverable: boolean;
  error: string;
}

export interface CancelledResult {
  surfaceId: string;
  status: "cancelled";
  recoverable: true;
  error: string;
}
