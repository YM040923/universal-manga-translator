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
  if (!isRecord(input)) {
    throw new TypeError("Invalid pipeline stage event");
  }

  const surfaceId = readOwnProperty(input, "surfaceId");
  const stage = readOwnProperty(input, "stage");
  const timestamp = readOwnProperty(input, "timestamp");
  if (!surfaceId.present
    || typeof surfaceId.value !== "string"
    || !stage.present
    || !isPipelineStage(stage.value)
    || !timestamp.present
    || !isNonNegativeFiniteNumber(timestamp.value)) {
    throw new TypeError("Invalid pipeline stage event");
  }

  const event: PipelineStageEvent = {
    surfaceId: surfaceId.value,
    stage: stage.value,
    timestamp: timestamp.value,
  };

  const unitId = readOwnProperty(input, "unitId");
  if (unitId.present && unitId.value !== undefined) {
    if (typeof unitId.value !== "string") throw new TypeError("Invalid pipeline stage event unitId");
    event.unitId = unitId.value;
  }
  const detail = readOwnProperty(input, "detail");
  if (detail.present && detail.value !== undefined) {
    if (typeof detail.value !== "string") throw new TypeError("Invalid pipeline stage event detail");
    event.detail = detail.value;
  }
  const elapsedMs = readOwnProperty(input, "elapsedMs");
  if (elapsedMs.present && elapsedMs.value !== undefined) {
    if (!isNonNegativeFiniteNumber(elapsedMs.value)) throw new TypeError("Invalid pipeline stage event elapsedMs");
    event.elapsedMs = elapsedMs.value;
  }

  return event;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readOwnProperty(input: object, key: string): { present: boolean; value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor) return { present: false, value: undefined };
  if ("value" in descriptor) return { present: true, value: descriptor.value };
  return { present: true, value: descriptor.get?.call(input) };
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
