import type { ApiResponse, AvailableModelsResponse, CacheStatsResponse, CancelJobSessionRequest, CancelJobSessionResponse, CancelSurfaceRequest, CancelSurfaceResponse, ClearCacheResponse, ClearDiagnosticsResponse, ConfigStatusResponse, ManualOverridePayload, SaveManualOverrideRequest, SaveManualOverrideResponse, ServerEvent, SubmitSurfaceRequest, SubmitSurfaceResponse } from "@umt/shared/protocol";
import type { SurfaceTask } from "@umt/shared/types";
import type { UmtBackendHttpRequest, UmtBackendHttpResponse } from "../messages.js";
import type { EventStreamTranslatorClient } from "./translator-client.js";

export interface SelfTestResponse {
  ok: true;
  provider: string;
  providerProfile: string;
  targetLanguage: string;
  steps: Array<{ name: string; ok: boolean; detail: string }>;
  sample: { status: string; regionCount: number; elapsedMs: number };
}

export function createEventUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/events`;
  url.search = "";
  return url.toString();
}

export class SurfaceSubmitTracker {
  private readonly submitted = new Set<string>();

  shouldSubmit(surfaceId: string): boolean {
    return !this.submitted.has(surfaceId);
  }

  markSubmitted(surfaceId: string): void {
    this.submitted.add(surfaceId);
  }

  release(surfaceId: string): void {
    this.submitted.delete(surfaceId);
  }

  clear(): void {
    this.submitted.clear();
  }
}

export interface DiagnosticsResponse { ok: true; records: Array<Record<string, unknown>>; }

export interface BackendClientOptions {
  timeoutMs?: number;
  retryCount?: number;
  backendHttp?: (request: { url: string; init?: UmtBackendHttpRequest["init"] }) => Promise<UmtBackendHttpResponse>;
}

export class BackendClient implements EventStreamTranslatorClient {
  constructor(private readonly baseUrl = "http://127.0.0.1:47831", private readonly options: BackendClientOptions = {}) {}

  eventsUrl(): string {
    return createEventUrl(this.baseUrl);
  }

  connectEvents(onEvent: (event: ServerEvent) => void): WebSocket {
    const socket = new WebSocket(this.eventsUrl());
    socket.addEventListener("message", (message) => onEvent(JSON.parse(String(message.data)) as ServerEvent));
    return socket;
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.getJson<{ ok?: boolean }>("/health");
      return Boolean(response.ok);
    } catch {
      return false;
    }
  }

  async configStatus(): Promise<ApiResponse<ConfigStatusResponse>> {
    return this.getJson<ApiResponse<ConfigStatusResponse>>("/v1/config/status");
  }

  async models(): Promise<ApiResponse<AvailableModelsResponse>> {
    return this.getJson<ApiResponse<AvailableModelsResponse>>("/v1/models");
  }

  async selfTest(): Promise<ApiResponse<SelfTestResponse>> {
    return this.postJson<SelfTestResponse>("/v1/self-test", {});
  }

  async submit(task: SurfaceTask, jobSessionId?: string): Promise<ApiResponse<SubmitSurfaceResponse>> {
    return this.postJson<SubmitSurfaceResponse>("/v1/surfaces/submit", withOptionalSession(task, jobSessionId));
  }

  async retranslate(task: SurfaceTask, jobSessionId?: string): Promise<ApiResponse<SubmitSurfaceResponse>> {
    return this.postJson<SubmitSurfaceResponse>("/v1/surfaces/retranslate", withOptionalSession(task, jobSessionId));
  }

  async cancelSurface(surfaceId: string): Promise<ApiResponse<CancelSurfaceResponse>> {
    return this.postJson<CancelSurfaceResponse>("/v1/surfaces/cancel", { surfaceId } satisfies CancelSurfaceRequest);
  }

  async cancelJobSession(jobSessionId: string): Promise<ApiResponse<CancelJobSessionResponse>> {
    return this.postJson<CancelJobSessionResponse>("/v1/jobs/cancel-session", { jobSessionId } satisfies CancelJobSessionRequest);
  }

  async cacheStats(): Promise<ApiResponse<CacheStatsResponse>> {
    return this.getJson<ApiResponse<CacheStatsResponse>>("/v1/cache/stats");
  }

  async clearCache(): Promise<ApiResponse<ClearCacheResponse>> {
    return this.postJson<ClearCacheResponse>("/v1/cache/clear", {});
  }

  async recentDiagnostics(limit = 10): Promise<ApiResponse<DiagnosticsResponse>> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    return this.getJson<ApiResponse<DiagnosticsResponse>>(`/v1/diagnostics/recent?limit=${safeLimit}`);
  }

  async clearDiagnostics(): Promise<ApiResponse<ClearDiagnosticsResponse>> {
    return this.postJson<ClearDiagnosticsResponse>("/v1/diagnostics/clear", {});
  }

  async saveManualOverride(override: ManualOverridePayload): Promise<ApiResponse<SaveManualOverrideResponse>> {
    return this.postJson<SaveManualOverrideResponse>("/v1/overrides", override satisfies SaveManualOverrideRequest);
  }

  private async postJson<T>(path: string, payload: unknown): Promise<ApiResponse<T>> {
    const maxAttempts = Math.max(1, Math.min(6, Math.trunc(this.options.retryCount ?? 0) + 1));
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = typeof AbortController !== "undefined" && this.options.timeoutMs ? new AbortController() : undefined;
      const timeout = controller ? setTimeout(() => controller.abort(), Math.max(1000, this.options.timeoutMs ?? 0)) : undefined;
      try {
        const body = JSON.stringify(payload);
        if (this.options.backendHttp) {
          const proxied = await this.options.backendHttp({ url: `${this.baseUrl}${path}`, init: { method: "POST", headers: { "content-type": "application/json" }, body } });
          if (!proxied.ok) {
            if (proxied.status && proxied.status >= 500 && attempt < maxAttempts) {
              lastError = new Error(proxied.error);
              continue;
            }
            return { ok: false, error: proxied.error } as ApiResponse<T>;
          }
          return proxied.body as ApiResponse<T>;
        }
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (!response.ok && response.status >= 500 && attempt < maxAttempts) {
          lastError = new Error(`Backend ${response.status}`);
          continue;
        }
        return (await response.json()) as ApiResponse<T>;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async getJson<T>(path: string): Promise<T> {
    if (this.options.backendHttp) {
      const proxied = await this.options.backendHttp({ url: `${this.baseUrl}${path}`, init: { method: "GET", cache: "no-store" } });
      if (!proxied.ok) throw new Error(proxied.error);
      return proxied.body as T;
    }
    const response = await fetch(`${this.baseUrl}${path}`, { cache: "no-store" });
    return (await response.json()) as T;
  }
}

function withOptionalSession(task: SurfaceTask, jobSessionId?: string): SubmitSurfaceRequest {
  return jobSessionId ? { task, jobSessionId } : { task };
}


