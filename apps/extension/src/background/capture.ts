import { isUmtBackendHttpRequest, isUmtCaptureVisibleTabRequest, isUmtDirectHttpRequest, isUmtFetchImageDataRequest, type UmtBackendHttpRequest, type UmtBackendHttpResponse, type UmtCaptureVisibleTabRequest, type UmtCaptureVisibleTabResponse, type UmtDirectHttpFormField, type UmtDirectHttpRequest, type UmtDirectHttpResponse, type UmtFetchImageDataRequest, type UmtFetchImageDataResponse } from "../content/messages.js";

export type CaptureVisibleTabFn = (windowId: number, options: chrome.tabs.CaptureVisibleTabOptions) => Promise<string>;
export type FetchImageFn = (url: string, init?: RequestInit) => Promise<Response>;

export async function handleCaptureVisibleTabMessage(
  message: UmtCaptureVisibleTabRequest,
  sender: chrome.runtime.MessageSender,
  captureVisibleTab: CaptureVisibleTabFn,
): Promise<UmtCaptureVisibleTabResponse> {
  try {
    const windowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
    const imageData = await captureVisibleTab(windowId, { format: "png" });
    if (!imageData || !imageData.startsWith("data:image/")) throw new Error("empty screenshot data from browser capture");
    return { ok: true, imageData };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const MAX_IMAGE_FETCH_BYTES = 32 * 1024 * 1024;

export async function handleFetchImageDataMessage(
  message: UmtFetchImageDataRequest,
  fetchImage: FetchImageFn = fetch,
): Promise<UmtFetchImageDataResponse> {
  try {
    const response = await fetchImage(message.url, {
      cache: "no-store",
      headers: {
        ...(message.referer ? { referer: message.referer } : {}),
        "user-agent": "UniversalMangaTranslator/0.1",
      },
    });
    if (!response.ok) throw new Error(`Image fetch failed: ${response.status} ${message.url}`);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0] || mimeFromUrl(message.url) || "image/png";
    if (!contentType.startsWith("image/")) throw new Error(`URL did not return an image: ${contentType}`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_FETCH_BYTES) {
      throw new Error(`Image exceeds the ${MAX_IMAGE_FETCH_BYTES / 1024 / 1024}MB limit.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_FETCH_BYTES) {
      throw new Error(`Image exceeds the ${MAX_IMAGE_FETCH_BYTES / 1024 / 1024}MB limit.`);
    }
    const imageData = `data:${contentType};base64,${bytesToBase64(bytes)}`;
    return { ok: true, imageData, contentType };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
export async function handleBackendHttpMessage(
  message: UmtBackendHttpRequest,
  fetchHttp: FetchImageFn = fetch,
): Promise<UmtBackendHttpResponse> {
  try {
    const init: RequestInit = {
      method: message.init?.method ?? "GET",
    };
    if (message.init?.headers) init.headers = message.init.headers;
    if (typeof message.init?.body === "string") init.body = message.init.body;
    if (message.init?.cache) init.cache = message.init.cache;
    const response = await fetchHttp(message.url, init);
    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok) return { ok: false, status: response.status, error: extractErrorMessage(body) || `Backend HTTP ${response.status}`, body };
    return { ok: true, status: response.status, body };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
export async function handleDirectHttpMessage(
  message: UmtDirectHttpRequest,
  fetchHttp: FetchImageFn = fetch,
): Promise<UmtDirectHttpResponse> {
  try {
    const init: RequestInit = { method: message.init?.method ?? "GET" };
    const headers = new Headers(message.init?.headers ?? {});
    const formFields = message.init?.formFields ?? [];
    if (formFields.length) {
      const form = new FormData();
      for (const field of formFields) appendDirectFormField(form, field);
      init.body = form;
      headers.delete("content-type");
    } else if (typeof message.init?.bodyText === "string") {
      init.body = message.init.bodyText;
    }
    if ([...headers.keys()].length) init.headers = Object.fromEntries(headers.entries());
    if (message.init?.cache) init.cache = message.init.cache;
    const response = await fetchHttp(message.url, init);
    const bodyText = await response.text();
    const responseHeaders = Object.fromEntries(response.headers.entries());
    if (!response.ok) return { ok: false, status: response.status, statusText: response.statusText, headers: responseHeaders, bodyText, error: extractErrorMessageFromText(bodyText) || `HTTP ${response.status}` };
    return { ok: true, status: response.status, statusText: response.statusText, headers: responseHeaders, bodyText };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerCaptureVisibleTabHandler(runtime: typeof chrome.runtime = chrome.runtime, tabs: typeof chrome.tabs = chrome.tabs): void {
  runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isUmtCaptureVisibleTabRequest(message)) {
      void handleCaptureVisibleTabMessage(message, sender, (windowId, options) => tabs.captureVisibleTab(windowId, options)).then(sendResponse);
      return true;
    }
    if (isUmtFetchImageDataRequest(message)) {
      void handleFetchImageDataMessage(message).then(sendResponse);
      return true;
    }
    if (isUmtBackendHttpRequest(message)) {
      void handleBackendHttpMessage(message).then(sendResponse);
      return true;
    }
    if (isUmtDirectHttpRequest(message)) {
      void handleDirectHttpMessage(message).then(sendResponse);
      return true;
    }
    return false;
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function mimeFromUrl(url: string): string | null {
  const path = (() => { try { return new URL(url).pathname; } catch { return url; } })().toLowerCase();
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".gif")) return "image/gif";
  return null;
}

function extractErrorMessage(body: unknown): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const candidate = body as { error?: unknown; message?: unknown };
    if (typeof candidate.error === "string") return candidate.error;
    if (typeof candidate.message === "string") return candidate.message;
  }
  return "";
}


function appendDirectFormField(form: FormData, field: UmtDirectHttpFormField): void {
  if (field.type === "text") {
    form.set(field.name, field.value);
    return;
  }
  const bytes = base64ToBytes(field.base64);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.set(field.name, new Blob([buffer], { type: field.mimeType || "application/octet-stream" }), field.fileName || "file.bin");
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function extractErrorMessageFromText(text: string): string {
  try {
    return extractErrorMessage(JSON.parse(text));
  } catch {
    return text.slice(0, 300);
  }
}
