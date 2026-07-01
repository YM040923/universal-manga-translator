import type { ApiResponse, CacheStatsResponse, CancelSurfaceRequest, CancelSurfaceResponse, ClearCacheResponse, ConfigStatusResponse, ManualOverridePayload, SaveManualOverrideRequest, SaveManualOverrideResponse, ServerEvent, SubmitSurfaceRequest, SubmitSurfaceResponse } from "@umt/shared/protocol";
import type { SurfaceTask } from "@umt/shared/types";

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

  clear(): void {
    this.submitted.clear();
  }
}

export interface DiagnosticsResponse { ok: true; records: Array<Record<string, unknown>>; }

export class BackendClient {
  constructor(private readonly baseUrl = "http://127.0.0.1:47831") {}

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
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok && Boolean((await response.json()).ok);
    } catch {
      return false;
    }
  }

  async configStatus(): Promise<ApiResponse<ConfigStatusResponse>> {
    const response = await fetch(`${this.baseUrl}/v1/config/status`, { cache: "no-store" });
    return (await response.json()) as ApiResponse<ConfigStatusResponse>;
  }

  async submit(task: SurfaceTask): Promise<ApiResponse<SubmitSurfaceResponse>> {
    const response = await fetch(`${this.baseUrl}/v1/surfaces/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task } satisfies SubmitSurfaceRequest),
    });
    return (await response.json()) as ApiResponse<SubmitSurfaceResponse>;
  }

  async retranslate(task: SurfaceTask): Promise<ApiResponse<SubmitSurfaceResponse>> {
    const response = await fetch(`${this.baseUrl}/v1/surfaces/retranslate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task } satisfies SubmitSurfaceRequest),
    });
    return (await response.json()) as ApiResponse<SubmitSurfaceResponse>;
  }

  async cancelSurface(surfaceId: string): Promise<ApiResponse<CancelSurfaceResponse>> {
    const response = await fetch(`${this.baseUrl}/v1/surfaces/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ surfaceId } satisfies CancelSurfaceRequest),
    });
    return (await response.json()) as ApiResponse<CancelSurfaceResponse>;
  }

  async cacheStats(): Promise<ApiResponse<CacheStatsResponse>> {
    const response = await fetch(`${this.baseUrl}/v1/cache/stats`, { cache: "no-store" });
    return (await response.json()) as ApiResponse<CacheStatsResponse>;
  }

  async clearCache(): Promise<ApiResponse<ClearCacheResponse>> {
    const response = await fetch(`${this.baseUrl}/v1/cache/clear`, { method: "POST" });
    return (await response.json()) as ApiResponse<ClearCacheResponse>;
  }

  async recentDiagnostics(limit = 10): Promise<ApiResponse<DiagnosticsResponse>> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const response = await fetch(`${this.baseUrl}/v1/diagnostics/recent?limit=${safeLimit}`, { cache: "no-store" });
    return (await response.json()) as ApiResponse<DiagnosticsResponse>;
  }

  async saveManualOverride(override: ManualOverridePayload): Promise<ApiResponse<SaveManualOverrideResponse>> {
    const response = await fetch(`${this.baseUrl}/v1/overrides`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(override satisfies SaveManualOverrideRequest),
    });
    return (await response.json()) as ApiResponse<SaveManualOverrideResponse>;
  }
}
