import type { OverlayAppearance } from "../settings/settings.js";
import type { QueueSnapshot } from "./queue/translation-queue.js";

export type UmtContentCommandName = "translate" | "refresh" | "togglePause" | "clearPage" | "selectRegion" | "retranslate" | "retranslateVisible" | "cancelQueue" | "setOverlayVisibility" | "toggleOverlayVisibility" | "applyOverlayAppearance" | "applySiteSettings" | "applyWidgetSettings" | "sampleOcrSelfTest" | "forceTranslate" | "pageInventory";

const CONTENT_COMMAND_NAMES: readonly UmtContentCommandName[] = ["translate", "refresh", "togglePause", "clearPage", "selectRegion", "retranslate", "retranslateVisible", "cancelQueue", "setOverlayVisibility", "toggleOverlayVisibility", "applyOverlayAppearance", "applySiteSettings", "applyWidgetSettings", "sampleOcrSelfTest", "forceTranslate", "pageInventory"];

/**
 * Commands only the top frame may act on: the selection crop is measured against the tab
 * viewport, the widgets are mounted once per tab, the popup's sample test expects one answer, and
 * the inventory is answered from the tab-level merge rather than one frame's queue.
 */
const CONTROLLER_ONLY_COMMANDS = new Set<UmtContentCommandName>(["selectRegion", "applyWidgetSettings", "sampleOcrSelfTest", "pageInventory"]);

/** Page commands the top frame's floating button may forward to the frames that hold the pages. */
const RELAYABLE_PAGE_COMMANDS = new Set<UmtContentCommandName>(["retranslateVisible", "setOverlayVisibility", "forceTranslate"]);

export function isUmtContentCommandName(value: unknown): value is UmtContentCommandName {
  return typeof value === "string" && (CONTENT_COMMAND_NAMES as readonly string[]).includes(value);
}

export function isControllerOnlyCommand(command: UmtContentCommandName): boolean {
  return CONTROLLER_ONLY_COMMANDS.has(command);
}

export function isRelayablePageCommand(command: unknown): command is UmtContentCommandName {
  return isUmtContentCommandName(command) && RELAYABLE_PAGE_COMMANDS.has(command);
}

export interface UmtContentCommand {
  source: "umt-popup" | "umt-page" | "umt-service-worker";
  command: UmtContentCommandName;
  visible?: boolean;
  appearance?: Partial<OverlayAppearance>;
  autoTranslate?: boolean;
  floatingButtonEnabled?: boolean;
  progressWidgetEnabled?: boolean;
  /** Set on commands the worker routed itself: the top frame already ran the action, so it must not run it again. */
  frameScoped?: boolean;
}

/**
 * What the tab's scanner saw, answered by the top frame from its merged view. Detection is silent
 * by design, so a page that never looked like a reader gave the reader no way to tell "no images"
 * from "images I refused to translate".
 */
export interface UmtPageInventoryResponse {
  ok: boolean;
  /** Surfaces accepted by the size and layout gates, across every frame of the tab. */
  detected: number;
  /** Surfaces actually queued for translation. */
  queued: number;
  /** This tab is already translating under a manual override. */
  forced: boolean;
  readerPage: boolean;
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
    timeoutMs?: number;
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
  /** Lets the sender cancel a request that is still running in the service worker. */
  requestId?: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    bodyText?: string;
    formFields?: UmtDirectHttpFormField[];
    cache?: RequestCache;
  };
}

export interface UmtDirectHttpCancelRequest {
  source: "umt-content" | "umt-popup";
  command: "directHttpCancel";
  requestId: string;
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
  if (candidate.source !== "umt-popup" && candidate.source !== "umt-page" && candidate.source !== "umt-service-worker") return false;
  if (!isUmtContentCommandName(candidate.command)) return false;
  return candidate.frameScoped === undefined || typeof candidate.frameScoped === "boolean";
}

export function isUmtPageInventoryResponse(value: unknown): value is UmtPageInventoryResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtPageInventoryResponse>;
  return typeof candidate.ok === "boolean"
    && typeof candidate.detected === "number"
    && typeof candidate.queued === "number"
    && typeof candidate.forced === "boolean"
    && typeof candidate.readerPage === "boolean";
}

export function isUmtCaptureVisibleTabRequest(value: unknown): value is UmtCaptureVisibleTabRequest {  if (!value || typeof value !== "object") return false;
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

export function isUmtDirectHttpCancelRequest(value: unknown): value is UmtDirectHttpCancelRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtDirectHttpCancelRequest>;
  return (candidate.source === "umt-content" || candidate.source === "umt-popup")
    && candidate.command === "directHttpCancel"
    && typeof candidate.requestId === "string"
    && candidate.requestId.length > 0
    && candidate.requestId.length <= 128;
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

/**
 * A frame asks the service worker whether it belongs to a site the reader enabled. Only the
 * service worker sees the tab's top-level URL, so an embedded cross-origin reader frame cannot
 * decide for itself that it is allowed to run.
 */
export interface UmtFrameContextRequest {
  source: "umt-content";
  command: "frameContext";
}

export interface UmtFrameContextResponse {
  ok: boolean;
  enabled: boolean;
  pageUrl: string;
}

/** Queue state of one frame, reported to the service worker so the tab can be summed up. */
export interface UmtFrameStatsReport {
  source: "umt-content";
  command: "frameStats";
  snapshot: QueueSnapshot;
}

export interface UmtFrameGoneReport {
  source: "umt-content";
  command: "frameGone";
}

/**
 * Queue state of every non-top frame, merged by the service worker and pushed to the frame that
 * owns the progress widget.
 */
export interface UmtFrameProgressMessage {
  source: "umt-service-worker";
  command: "frameProgress";
  snapshot: QueueSnapshot;
}

/**
 * The top frame pulls the merge once after it starts listening: a child frame can finish its first
 * scan before the top frame's listener exists, and then its push would be lost for the whole visit.
 */
export interface UmtFrameProgressRequest {
  source: "umt-content";
  command: "frameProgressRequest";
}

export interface UmtFrameProgressResponse {
  snapshot: QueueSnapshot;
}

/** The top frame has no surfaces; ask the worker to run the sample test in the busiest frame. */
export interface UmtDelegateSelfTestRequest {
  source: "umt-content";
  command: "delegateSelfTest";
}

export type UmtDelegateSelfTestResponse = UmtPageSampleSelfTestResponse | { ok: false; status: "no-frame"; detail: string };

/** The widget lives in the top frame, so its buttons have to reach the reader frames through the worker. */
export interface UmtFrameRelayRequest {
  source: "umt-content";
  command: "relayToFrames";
  pageCommand: UmtContentCommandName;
  visible?: boolean;
}

export interface UmtFrameRelayResponse {
  ok: boolean;
}

/** The top frame saw an iframe appear; ask the worker to inject into frames the tab now has. */
export interface UmtEnsureFramesRequest {
  source: "umt-content";
  command: "ensureFrames";
}

export interface UmtEnsureFramesResponse {
  ok: boolean;
}

function isQueueSnapshot(value: unknown): value is QueueSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<QueueSnapshot>;
  return typeof snapshot.total === "number"
    && typeof snapshot.detected === "number"
    && typeof snapshot.queued === "number"
    && typeof snapshot.processing === "number"
    && typeof snapshot.completed === "number"
    && typeof snapshot.cached === "number"
    && typeof snapshot.empty === "number"
    && typeof snapshot.failed === "number"
    && typeof snapshot.cancelled === "number"
    && typeof snapshot.paused === "boolean";
}

export function isUmtFrameContextRequest(value: unknown): value is UmtFrameContextRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtFrameContextRequest>;
  return candidate.source === "umt-content" && candidate.command === "frameContext";
}

export function isUmtFrameStatsReport(value: unknown): value is UmtFrameStatsReport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtFrameStatsReport>;
  return candidate.source === "umt-content"
    && candidate.command === "frameStats"
    && isQueueSnapshot(candidate.snapshot);
}

export function isUmtFrameGoneReport(value: unknown): value is UmtFrameGoneReport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtFrameGoneReport>;
  return candidate.source === "umt-content" && candidate.command === "frameGone";
}

export function isUmtFrameProgressMessage(value: unknown): value is UmtFrameProgressMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtFrameProgressMessage>;
  return candidate.source === "umt-service-worker"
    && candidate.command === "frameProgress"
    && isQueueSnapshot(candidate.snapshot);
}

export function isUmtFrameProgressRequest(value: unknown): value is UmtFrameProgressRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtFrameProgressRequest>;
  return candidate.source === "umt-content" && candidate.command === "frameProgressRequest";
}

export function isUmtDelegateSelfTestRequest(value: unknown): value is UmtDelegateSelfTestRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtDelegateSelfTestRequest>;
  return candidate.source === "umt-content" && candidate.command === "delegateSelfTest";
}

export function isUmtFrameRelayRequest(value: unknown): value is UmtFrameRelayRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtFrameRelayRequest>;
  return candidate.source === "umt-content"
    && candidate.command === "relayToFrames"
    && typeof candidate.pageCommand === "string"
    && isRelayablePageCommand(candidate.pageCommand);
}

export function isUmtEnsureFramesRequest(value: unknown): value is UmtEnsureFramesRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtEnsureFramesRequest>;
  return candidate.source === "umt-content" && candidate.command === "ensureFrames";
}
