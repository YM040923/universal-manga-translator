import type { ApiResponse, AvailableModelsResponse, CacheStatsResponse, CancelJobSessionRequest, CancelJobSessionResponse, CancelSurfaceRequest, CancelSurfaceResponse, ClearCacheResponse, ClearDiagnosticsResponse, ConfigStatusResponse, ManualOverridePayload, SaveManualOverrideRequest, SaveManualOverrideResponse, ServerEvent, SubmitSurfaceRequest, SubmitSurfaceResponse } from "@umt/shared/protocol";
import type { SurfaceTask } from "@umt/shared/types";
import { ChapterTranslationMemory } from "./chapter-memory.js";
import { dataUrlToBytes, sha256Hex } from "./direct-image-utils.js";
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

export function createEventUrl(baseUrl: string, sessionId?: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/events`;
  url.search = sessionId ? `sessionId=${encodeURIComponent(sessionId)}` : "";
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
  /** Reader-specific term replacements sent with each submit so the backend honours them. */
  glossary?: Record<string, string>;
  backendHttp?: (request: { url: string; init?: UmtBackendHttpRequest["init"] }) => Promise<UmtBackendHttpResponse>;
}

export interface EventSessionResponse {
  ok: true;
  sessionId: string;
}

export class BackendClient implements EventStreamTranslatorClient {
  private eventSession?: Promise<string> | undefined;
  private observedProviderProfile?: string | undefined;
  private readonly chapterMemory = new ChapterTranslationMemory();

  constructor(private readonly baseUrl = "http://127.0.0.1:47831", private readonly options: BackendClientOptions = {}) {}

  /**
   * The backend picks the profile from its own config, so the reader's cached chapter
   * results must key off what the server reports rather than the local placeholder.
   */
  providerProfile(): string {
    return this.observedProviderProfile ?? "";
  }

  eventsUrl(sessionId?: string): string {
    return createEventUrl(this.baseUrl, sessionId);
  }

  async connectEvents(onEvent: (event: ServerEvent) => void): Promise<WebSocket> {
    const socket = new WebSocket(this.eventsUrl(await this.subscribeSession()));
    socket.addEventListener("message", (message) => onEvent(JSON.parse(String(message.data)) as ServerEvent));
    return socket;
  }

  /**
   * The backend does not apply CORS to WebSocket handshakes, so it only accepts
   * /v1/events for a session id handed out over a CORS-guarded HTTP call. A
   * webpage cannot read that response and therefore cannot subscribe.
   */
  private subscribeSession(): Promise<string> {
    this.eventSession ??= this.postJson<EventSessionResponse>("/v1/session", {})
      .then((response) => {
        if (!response.ok) throw new Error(response.error);
        return response.sessionId;
      })
      .catch((error: unknown) => {
        this.eventSession = undefined;
        throw error;
      });
    return this.eventSession;
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
    return this.submitTo("/v1/surfaces/submit", task, jobSessionId);
  }

  async retranslate(task: SurfaceTask, jobSessionId?: string): Promise<ApiResponse<SubmitSurfaceResponse>> {
    return this.submitTo("/v1/surfaces/retranslate", task, jobSessionId);
  }

  private async submitTo(path: string, task: SurfaceTask, jobSessionId?: string): Promise<ApiResponse<SubmitSurfaceResponse>> {
    const response = await this.postJson<SubmitSurfaceResponse>(path, await this.submitRequest(task, jobSessionId));
    if (response.ok && response.result) this.chapterMemory.remember(response.result.imageHash, response.result);
    return this.rememberProfile(response);
  }

  private async submitRequest(task: SurfaceTask, jobSessionId?: string): Promise<SubmitSurfaceRequest> {
    const request: SubmitSurfaceRequest = { task, ...(await this.chapterHints(task)) };
    if (jobSessionId) request.jobSessionId = jobSessionId;
    return this.options.glossary && Object.keys(this.options.glossary).length ? { ...request, glossary: this.options.glossary } : request;
  }

  /**
   * Direct mode keeps the chapter's earlier bubbles locally and translate Page 7 differently
   * because of them, so backend mode has to ship the same hints or the two modes disagree.
   */
  private async chapterHints(task: SurfaceTask): Promise<{ chapterContext?: string; termCandidates?: string[] }> {
    if (!task.imageData) return {};
    let imageHash: string;
    try {
      imageHash = await sha256Hex(dataUrlToBytes(task.imageData));
    } catch {
      return {};
    }
    const chapterContext = this.chapterMemory.chapterContextFor(imageHash);
    const termCandidates = this.chapterMemory.termCandidatesFor(imageHash);
    return {
      ...(chapterContext ? { chapterContext } : {}),
      ...(termCandidates.length ? { termCandidates } : {}),
    };
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
    const response = await this.postJson<SaveManualOverrideResponse>("/v1/overrides", override satisfies SaveManualOverrideRequest);
    if (response.ok) this.chapterMemory.applyManualOverride(override);
    return response;
  }

  private rememberProfile(response: ApiResponse<SubmitSurfaceResponse>): ApiResponse<SubmitSurfaceResponse> {
    const profile = response.ok ? response.result?.providerProfile : undefined;
    if (typeof profile === "string" && profile) this.observedProviderProfile = profile;
    return response;
  }

  private async postJson<T>(path: string, payload: unknown): Promise<ApiResponse<T>> {
    const maxAttempts = Math.max(1, Math.min(6, Math.trunc(this.options.retryCount ?? 0) + 1));
    const timeoutMs = this.timeoutMs();
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // A proxied request runs in the service worker, so it enforces its own deadline.
      const controller = timeoutMs && !this.options.backendHttp ? new AbortController() : undefined;
      const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
      try {
        const body = JSON.stringify(payload);
        if (this.options.backendHttp) {
          const proxied = await this.options.backendHttp({ url: `${this.baseUrl}${path}`, init: { method: "POST", headers: { "content-type": "application/json" }, body, ...(timeoutMs ? { timeoutMs } : {}) } });
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
    const timeoutMs = this.timeoutMs();
    if (this.options.backendHttp) {
      const proxied = await this.options.backendHttp({ url: `${this.baseUrl}${path}`, init: { method: "GET", cache: "no-store", ...(timeoutMs ? { timeoutMs } : {}) } });
      if (!proxied.ok) throw new Error(proxied.error);
      return proxied.body as T;
    }
    const controller = timeoutMs ? new AbortController() : undefined;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return (await response.json()) as T;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private timeoutMs(): number | undefined {
    const value = this.options.timeoutMs;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
    return Math.max(1000, Math.trunc(value));
  }
}



