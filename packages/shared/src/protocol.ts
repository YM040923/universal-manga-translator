import type { CancelledResult, FailedResult, JobStatus, SurfaceResult, SurfaceTask } from "./types.js";

export interface SubmitSurfaceRequest { task: SurfaceTask; jobSessionId?: string; }
export interface SubmitSurfaceResponse { ok: true; surfaceId: string; status: JobStatus; result?: SurfaceResult; }
export interface ErrorResponse { ok: false; error: string; }
export type ApiResponse<T> = T | ErrorResponse;

export interface CacheStatsResponse { ok: true; stats: { entries: number; bytes: number; updatedAt: number | null }; }
export interface ClearCacheResponse { ok: true; deleted: number; }
export interface ClearDiagnosticsResponse { ok: true; deleted: number; }
export interface CancelSurfaceRequest { surfaceId: string; }
export interface CancelSurfaceResponse { ok: true; surfaceId: string; status: "accepted"; cancellable: boolean; }
export interface CancelJobSessionRequest { jobSessionId: string; }
export interface CancelJobSessionResponse { ok: true; jobSessionId: string; status: "cancelled"; cancellable: boolean; }

export interface ManualOverridePayload {
  imageHash: string;
  targetLanguage: string;
  regionId: string;
  translatedText: string;
}
export interface SaveManualOverrideRequest extends ManualOverridePayload {}
export interface SaveManualOverrideResponse { ok: true; override: ManualOverridePayload; }
export interface ListManualOverridesResponse { ok: true; overrides: ManualOverridePayload[]; }

export interface ConfigStatusResponse {
  ok: true;
  provider: string;
  targetLanguage: string;
  providerProfile: string;
  openAICompatible: {
    baseUrl: string;
    model: string;
    apiKeyConfigured: boolean;
    imageInputFormat?: "image-url" | "image-field";
  };
  ocr?: {
    provider: string;
    apiKeyConfigured: boolean;
    keyPool?: {
      count: number;
      available: number;
      keys: Array<{
        label: string;
        state: "ready" | "blocked";
        failures: number;
        lastError?: string;
      }>;
    };
    apiUrl?: string;
    endpoint?: string;
    inputMode?: "image_base64" | "file";
    input?: "image_base64" | "file";
    imageField?: string;
    staticFields?: Record<string, unknown>;
    regionsPaths?: string[];
    textPaths?: string[];
    boxPaths?: string[];
    confidencePaths?: string[];
  };
  image?: {
    maxLongEdge: number;
    jpegQuality: number;
  };
  configWritable?: boolean;
}

export interface AvailableModelsResponse {
  ok: true;
  models: string[];
  currentModel: string;
}

export interface UpdateConfigRequest {
  provider?: string;
  targetLanguage?: string;
  openAICompatible?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    imageInputFormat?: "image-url" | "image-field";
  };
  ocr?: {
    apiUrl?: string;
    apiKey?: string;
    apiKeys?: string | string[];
    inputMode?: "image_base64" | "file";
    imageField?: string;
    staticFields?: Record<string, unknown>;
    regionsPaths?: string | string[];
    textPaths?: string | string[];
    boxPaths?: string | string[];
    confidencePaths?: string | string[];
  };
  image?: {
    maxLongEdge?: number;
    jpegQuality?: number;
  };
}

export interface UpdateConfigResponse {
  ok: true;
  status: ConfigStatusResponse;
  restarted: false;
  note: string;
}

export type ServerEvent =
  | { type: "backend.ready"; port: number }
  | { type: "job.queued"; surfaceId: string; jobSessionId?: string }
  | { type: "job.processing"; surfaceId: string; jobSessionId?: string }
  | { type: "job.cached"; surfaceId: string; jobSessionId?: string; result: SurfaceResult }
  | { type: "job.completed"; surfaceId: string; jobSessionId?: string; result: SurfaceResult }
  | { type: "job.failed"; surfaceId: string; jobSessionId?: string; result: FailedResult }
  | { type: "job.cancelled"; surfaceId: string; jobSessionId: string; result: CancelledResult };
