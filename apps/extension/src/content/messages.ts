import type { OverlayAppearance } from "../settings/settings.js";

export type UmtContentCommandName = "translate" | "refresh" | "togglePause" | "clearPage" | "selectRegion" | "retranslate" | "retranslateVisible" | "cancelQueue" | "setOverlayVisibility" | "toggleOverlayVisibility" | "applyOverlayAppearance" | "applySiteSettings" | "applyWidgetSettings" | "sampleOcrSelfTest";

export interface UmtContentCommand {
  source: "umt-popup" | "umt-page";
  command: UmtContentCommandName;
  visible?: boolean;
  appearance?: Partial<OverlayAppearance>;
  autoTranslate?: boolean;
  floatingButtonEnabled?: boolean;
  progressWidgetEnabled?: boolean;
}

export type UmtPageSampleSelfTestResponse =
  | { ok: true; status: "ok"; surfaceId?: string; surfaceIndex: number; regionCount: number; elapsedMs: number; providerProfile?: string }
  | { ok: false; status: "no-reader-page" | "no-surface" | "empty" | "failed"; detail: string; surfaceId?: string; surfaceIndex?: number; elapsedMs?: number; providerProfile?: string };

export interface UmtCaptureVisibleTabRequest {
  source: "umt-content";
  command: "captureVisibleTab";
}

export interface UmtCaptureVisibleTabSuccess {
  ok: true;
  imageData: string;
}

export interface UmtCaptureVisibleTabFailure {
  ok: false;
  error: string;
}

export type UmtCaptureVisibleTabResponse = UmtCaptureVisibleTabSuccess | UmtCaptureVisibleTabFailure;

export interface UmtFetchImageDataRequest {
  source: "umt-content";
  command: "fetchImageData";
  url: string;
  referer?: string;
}

export interface UmtFetchImageDataSuccess {
  ok: true;
  imageData: string;
  contentType: string;
}

export interface UmtFetchImageDataFailure {
  ok: false;
  error: string;
}

export type UmtFetchImageDataResponse = UmtFetchImageDataSuccess | UmtFetchImageDataFailure;

export interface UmtBackendHttpRequest {
  source: "umt-content";
  command: "backendHttp";
  url: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    cache?: RequestCache;
  };
}

export interface UmtBackendHttpSuccess {
  ok: true;
  status: number;
  body: unknown;
}

export interface UmtBackendHttpFailure {
  ok: false;
  status?: number;
  error: string;
  body?: unknown;
}

export type UmtBackendHttpResponse = UmtBackendHttpSuccess | UmtBackendHttpFailure;

export type UmtDirectHttpFormField =
  | { type: "text"; name: string; value: string }
  | { type: "file"; name: string; fileName: string; mimeType: string; base64: string };

export interface UmtDirectHttpRequest {
  source: "umt-content" | "umt-popup";
  command: "directHttp";
  url: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    bodyText?: string;
    formFields?: UmtDirectHttpFormField[];
    cache?: RequestCache;
  };
}

export interface UmtDirectHttpSuccess {
  ok: true;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
}

export interface UmtDirectHttpFailure {
  ok: false;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  bodyText?: string;
  error: string;
}

export type UmtDirectHttpResponse = UmtDirectHttpSuccess | UmtDirectHttpFailure;

export function isUmtContentCommand(value: unknown): value is UmtContentCommand {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtContentCommand>;
  return (candidate.source === "umt-popup" || candidate.source === "umt-page") && (
    candidate.command === "translate" ||
    candidate.command === "refresh" ||
    candidate.command === "togglePause" ||
    candidate.command === "clearPage" ||
    candidate.command === "selectRegion" ||
    candidate.command === "retranslate" ||
    candidate.command === "retranslateVisible" ||
    candidate.command === "cancelQueue" ||
    candidate.command === "setOverlayVisibility" ||
    candidate.command === "toggleOverlayVisibility" ||
    candidate.command === "applyOverlayAppearance" ||
    candidate.command === "applySiteSettings" ||
    candidate.command === "applyWidgetSettings" ||
    candidate.command === "sampleOcrSelfTest"
  );
}

export function isUmtCaptureVisibleTabRequest(value: unknown): value is UmtCaptureVisibleTabRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtCaptureVisibleTabRequest>;
  return candidate.source === "umt-content" && candidate.command === "captureVisibleTab";
}

export function isUmtFetchImageDataRequest(value: unknown): value is UmtFetchImageDataRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtFetchImageDataRequest>;
  return candidate.source === "umt-content" && candidate.command === "fetchImageData" && typeof candidate.url === "string" && candidate.url.length > 0;
}

export function isUmtBackendHttpRequest(value: unknown): value is UmtBackendHttpRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtBackendHttpRequest>;
  return candidate.source === "umt-content"
    && candidate.command === "backendHttp"
    && typeof candidate.url === "string"
    && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i.test(candidate.url);
}

export function isUmtDirectHttpRequest(value: unknown): value is UmtDirectHttpRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtDirectHttpRequest>;
  if ((candidate.source !== "umt-content" && candidate.source !== "umt-popup") || candidate.command !== "directHttp" || typeof candidate.url !== "string") return false;
  return directHttpUrlPolicyError(candidate.url) === "";
}

export function directHttpUrlPolicyError(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return "";
    if (url.protocol !== "http:") return "API URL must use https://, except local http://127.0.0.1 / localhost / [::1].";
    if (isLoopbackHost(url.hostname)) return "";
    return "Remote API URL must use https://. Plain http:// is only allowed for local 127.0.0.1 / localhost / [::1].";
  } catch {
    return "API URL is invalid.";
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}


export interface UmtActivateSiteRequest {
  source: "umt-popup";
  command: "activateSite";
  tabId: number;
  url: string;
}

export interface UmtActivateSiteResponse {
  ok: boolean;
  error?: string;
}

export function isUmtActivateSiteRequest(value: unknown): value is UmtActivateSiteRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtActivateSiteRequest>;
  return candidate.source === "umt-popup"
    && candidate.command === "activateSite"
    && typeof candidate.tabId === "number"
    && typeof candidate.url === "string";
}



