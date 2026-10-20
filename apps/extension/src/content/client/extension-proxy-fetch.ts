import type { UmtDirectHttpCancelRequest, UmtDirectHttpRequest, UmtDirectHttpResponse } from "../messages.js";

type FetchLike = typeof fetch;

export function createExtensionProxyFetch(): FetchLike {
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = await serializeDirectHttpRequest(input, init);
      const signal = init?.signal ?? undefined;
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      const requestId = nextRequestId();
      const abortProxy = () => { void chrome.runtime.sendMessage({ source: "umt-content", command: "directHttpCancel", requestId } as UmtDirectHttpCancelRequest).catch(() => {}); };
      signal?.addEventListener("abort", abortProxy, { once: true });
      try {
        const proxied = await chrome.runtime.sendMessage({ source: "umt-content", command: "directHttp", requestId, ...request }) as UmtDirectHttpResponse;
        const headers = new Headers(proxied.headers ?? {});
        if (!proxied.ok) {
          return new Response(proxied.bodyText ?? JSON.stringify({ error: proxied.error }), { status: proxied.status ?? 599, statusText: proxied.statusText ?? proxied.error, headers });
        }
        return new Response(proxied.bodyText, { status: proxied.status, statusText: proxied.statusText, headers });
      } finally {
        signal?.removeEventListener("abort", abortProxy);
      }
    }) as FetchLike;
  }
  return globalThis.fetch;
}

let requestSequence = 0;

function nextRequestId(): string {
  requestSequence += 1;
  return `${Date.now().toString(36)}-${requestSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function serializeDirectHttpRequest(input: RequestInfo | URL, init?: RequestInit): Promise<{ url: string; init: UmtDirectHttpRequest["init"] }> {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const headers = headersToRecord(init?.headers);
  const body = init?.body;
  const serialized: NonNullable<UmtDirectHttpRequest["init"]> = { headers };
  if (init?.method) serialized.method = init.method;
  if (init?.cache) serialized.cache = init.cache;
  if (body instanceof FormData) {
    serialized.formFields = [];
    for (const [name, value] of body.entries()) {
      if (typeof value === "string") serialized.formFields.push({ type: "text", name, value });
      else {
        const bytes = new Uint8Array(await value.arrayBuffer());
        serialized.formFields.push({ type: "file", name, fileName: value.name || "file.bin", mimeType: value.type || "application/octet-stream", base64: bytesToBase64(bytes) });
      }
    }
  } else if (typeof body === "string") {
    serialized.bodyText = body;
  } else if (body) {
    serialized.bodyText = String(body);
  }
  return { url, init: serialized };
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  new Headers(headers).forEach((value, key) => { result[key] = value; });
  return result;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}
