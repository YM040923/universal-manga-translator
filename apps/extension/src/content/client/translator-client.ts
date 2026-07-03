import type {
  ApiResponse,
  AvailableModelsResponse,
  CacheStatsResponse,
  CancelJobSessionResponse,
  CancelSurfaceResponse,
  ClearCacheResponse,
  ClearDiagnosticsResponse,
  ConfigStatusResponse,
  ManualOverridePayload,
  SaveManualOverrideResponse,
  ServerEvent,
  SubmitSurfaceResponse,
} from "@umt/shared/protocol";
import type { SurfaceTask } from "@umt/shared/types";
import type { DiagnosticsResponse, SelfTestResponse } from "./backend-client.js";

export interface TranslatorClient {
  health(): Promise<boolean>;
  configStatus(): Promise<ApiResponse<ConfigStatusResponse>>;
  models(): Promise<ApiResponse<AvailableModelsResponse>>;
  selfTest(): Promise<ApiResponse<SelfTestResponse>>;
  submit(task: SurfaceTask, jobSessionId?: string): Promise<ApiResponse<SubmitSurfaceResponse>>;
  retranslate(task: SurfaceTask, jobSessionId?: string): Promise<ApiResponse<SubmitSurfaceResponse>>;
  cancelSurface(surfaceId: string): Promise<ApiResponse<CancelSurfaceResponse>>;
  cancelJobSession(jobSessionId: string): Promise<ApiResponse<CancelJobSessionResponse>>;
  cacheStats(): Promise<ApiResponse<CacheStatsResponse>>;
  clearCache(): Promise<ApiResponse<ClearCacheResponse>>;
  recentDiagnostics(limit?: number): Promise<ApiResponse<DiagnosticsResponse>>;
  clearDiagnostics(): Promise<ApiResponse<ClearDiagnosticsResponse>>;
  saveManualOverride(override: ManualOverridePayload): Promise<ApiResponse<SaveManualOverrideResponse>>;
  providerProfile?(): string;
}

export interface EventStreamTranslatorClient extends TranslatorClient {
  connectEvents(onEvent: (event: ServerEvent) => void): WebSocket;
}

export function supportsEventStream(client: TranslatorClient): client is EventStreamTranslatorClient {
  return typeof (client as Partial<EventStreamTranslatorClient>).connectEvents === "function";
}
