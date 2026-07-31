export const PIPELINE_STAGES = [
  "idle",
  "queued",
  "capturing",
  "planning",
  "ocr",
  "ocr-rescue",
  "bubble-detection",
  "translating",
  "layout",
  "rendering",
  "completed",
  "cached",
  "empty",
  "failed",
  "cancelled",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface PipelineStageEvent {
  surfaceId: string;
  stage: PipelineStage;
  timestamp: number;
  unitId?: string;
  detail?: string;
  elapsedMs?: number;
}

export type PipelineStageTiming = PipelineStageEvent & { elapsedMs: number };

const pipelineStageSet = new Set<string>(PIPELINE_STAGES);

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && pipelineStageSet.has(value);
}

export function toSafePipelineStageEvent(input: unknown): PipelineStageEvent {
  if (!isRecord(input)
    || typeof input.surfaceId !== "string"
    || !isPipelineStage(input.stage)
    || !isFiniteNumber(input.timestamp)) {
    throw new TypeError("Invalid pipeline stage event");
  }

  const event: PipelineStageEvent = {
    surfaceId: input.surfaceId,
    stage: input.stage,
    timestamp: input.timestamp,
  };

  if (input.unitId !== undefined) {
    if (typeof input.unitId !== "string") throw new TypeError("Invalid pipeline stage event unitId");
    event.unitId = input.unitId;
  }
  if (input.detail !== undefined) {
    if (typeof input.detail !== "string") throw new TypeError("Invalid pipeline stage event detail");
    event.detail = input.detail;
  }
  if (input.elapsedMs !== undefined) {
    if (!isFiniteNumber(input.elapsedMs)) throw new TypeError("Invalid pipeline stage event elapsedMs");
    event.elapsedMs = input.elapsedMs;
  }

  return event;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
