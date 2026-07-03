import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

if (typeof globalThis.btoa === "undefined") {
  globalThis.btoa = (value: string) => Buffer.from(value, "binary").toString("base64");
}
import { handleBackendHttpMessage, handleCaptureVisibleTabMessage, handleDirectHttpMessage, handleFetchImageDataMessage } from "./capture.js";
import { isUmtBackendHttpRequest, isUmtCaptureVisibleTabRequest, isUmtDirectHttpRequest, isUmtFetchImageDataRequest } from "../content/messages.js";

test("isUmtCaptureVisibleTabRequest validates screenshot capture requests", () => {
  assert.equal(isUmtCaptureVisibleTabRequest({ source: "umt-content", command: "captureVisibleTab" }), true);
  assert.equal(isUmtCaptureVisibleTabRequest({ source: "umt-popup", command: "captureVisibleTab" }), false);
  assert.equal(isUmtCaptureVisibleTabRequest({ source: "umt-content", command: "translate" }), false);
});

test("handleCaptureVisibleTabMessage returns captured data url", async () => {
  const response = await handleCaptureVisibleTabMessage(
    { source: "umt-content", command: "captureVisibleTab" },
    { tab: { windowId: 7 } as chrome.tabs.Tab },
    async (windowId: number, options: chrome.tabs.CaptureVisibleTabOptions) => {
      assert.equal(windowId, 7);
      assert.deepEqual(options, { format: "png" });
      return "data:image/png;base64,abc";
    },
  );

  assert.deepEqual(response, { ok: true, imageData: "data:image/png;base64,abc" });
});

test("handleCaptureVisibleTabMessage reports capture errors", async () => {
  const response = await handleCaptureVisibleTabMessage(
    { source: "umt-content", command: "captureVisibleTab" },
    { tab: { windowId: 1 } as chrome.tabs.Tab },
    async () => { throw new Error("denied"); },
  );

  assert.deepEqual(response, { ok: false, error: "denied" });
});
test("handleCaptureVisibleTabMessage reports empty capture data", async () => {
  const response = await handleCaptureVisibleTabMessage(
    { source: "umt-content", command: "captureVisibleTab" },
    { tab: { windowId: 1 } as chrome.tabs.Tab },
    async () => "",
  );

  assert.equal(response.ok, false);
  assert.match(response.ok ? "" : response.error, /empty screenshot/i);
});


test("isUmtFetchImageDataRequest validates extension-side image fetch requests", () => {
  assert.equal(isUmtFetchImageDataRequest({ source: "umt-content", command: "fetchImageData", url: "https://cdn.example/page.webp" }), true);
  assert.equal(isUmtFetchImageDataRequest({ source: "umt-content", command: "fetchImageData" }), false);
  assert.equal(isUmtFetchImageDataRequest({ source: "umt-popup", command: "fetchImageData", url: "https://cdn.example/page.webp" }), false);
});

test("handleFetchImageDataMessage fetches an image as a data url", async () => {
  const response = await handleFetchImageDataMessage(
    { source: "umt-content", command: "fetchImageData", url: "https://cdn.example/page.webp", referer: "https://reader.example/chapter/1" },
    async (url: string, init?: RequestInit) => {
      assert.equal(url, "https://cdn.example/page.webp");
      assert.equal((init?.headers as Record<string, string>).referer, "https://reader.example/chapter/1");
      return new Response(Buffer.from("abc"), { status: 200, headers: { "content-type": "image/webp" } });
    },
  );

  assert.deepEqual(response, { ok: true, imageData: "data:image/webp;base64,YWJj", contentType: "image/webp" });
});

test("handleFetchImageDataMessage reports HTTP failures", async () => {
  const response = await handleFetchImageDataMessage(
    { source: "umt-content", command: "fetchImageData", url: "https://cdn.example/page.webp" },
    async () => new Response("rate limited", { status: 429 }),
  );

  assert.equal(response.ok, false);
  assert.match(response.ok ? "" : response.error, /429/);
});

test("isUmtBackendHttpRequest only allows loopback backend proxy requests", () => {
  assert.equal(isUmtBackendHttpRequest({ source: "umt-content", command: "backendHttp", url: "http://127.0.0.1:47831/health" }), true);
  assert.equal(isUmtBackendHttpRequest({ source: "umt-content", command: "backendHttp", url: "http://localhost:47831/health" }), true);
  assert.equal(isUmtBackendHttpRequest({ source: "umt-content", command: "backendHttp", url: "https://example.com/health" }), false);
  assert.equal(isUmtBackendHttpRequest({ source: "umt-popup", command: "backendHttp", url: "http://127.0.0.1:47831/health" }), false);
});

test("handleBackendHttpMessage proxies JSON requests from content script through extension background", async () => {
  const response = await handleBackendHttpMessage(
    {
      source: "umt-content",
      command: "backendHttp",
      url: "http://127.0.0.1:47831/v1/surfaces/submit",
      init: { method: "POST", headers: { "content-type": "application/json" }, body: "{\"task\":true}" },
    },
    async (url: string, init?: RequestInit) => {
      assert.equal(url, "http://127.0.0.1:47831/v1/surfaces/submit");
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>)["content-type"], "application/json");
      assert.equal(init?.body, "{\"task\":true}");
      return new Response(JSON.stringify({ ok: true, status: "completed" }), { status: 200, headers: { "content-type": "application/json" } });
    },
  );

  assert.deepEqual(response, { ok: true, status: 200, body: { ok: true, status: "completed" } });
});

test("handleBackendHttpMessage reports failed proxied requests with response body", async () => {
  const response = await handleBackendHttpMessage(
    { source: "umt-content", command: "backendHttp", url: "http://127.0.0.1:47831/v1/surfaces/submit" },
    async () => new Response(JSON.stringify({ ok: false, error: "Payload Too Large" }), { status: 413, headers: { "content-type": "application/json" } }),
  );

  assert.equal(response.ok, false);
  assert.equal(response.status, 413);
  assert.deepEqual(response.body, { ok: false, error: "Payload Too Large" });
});

test("isUmtDirectHttpRequest accepts generic HTTP API calls from extension contexts", () => {
  assert.equal(isUmtDirectHttpRequest({ source: "umt-content", command: "directHttp", url: "https://ocr.example/ocr" }), true);
  assert.equal(isUmtDirectHttpRequest({ source: "umt-popup", command: "directHttp", url: "http://127.0.0.1:9000/ocr" }), true);
  assert.equal(isUmtDirectHttpRequest({ source: "umt-content", command: "directHttp", url: "file:///etc/passwd" }), false);
  assert.equal(isUmtDirectHttpRequest({ source: "umt-content", command: "backendHttp", url: "https://ocr.example/ocr" }), false);
});

test("handleDirectHttpMessage proxies text requests and returns raw JSON text", async () => {
  const response = await handleDirectHttpMessage(
    {
      source: "umt-content",
      command: "directHttp",
      url: "https://api.example/v1/chat/completions",
      init: { method: "POST", headers: { authorization: "Bearer key", "content-type": "application/json" }, bodyText: "{\"model\":\"gpt\"}" },
    },
    async (url: string, init?: RequestInit) => {
      assert.equal(url, "https://api.example/v1/chat/completions");
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer key");
      assert.equal(init?.body, "{\"model\":\"gpt\"}");
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    },
  );

  assert.equal(response.ok, true);
  assert.equal(response.ok && response.bodyText, "{\"ok\":true}");
});

test("handleDirectHttpMessage rebuilds multipart form fields in background", async () => {
  const response = await handleDirectHttpMessage(
    {
      source: "umt-content",
      command: "directHttp",
      url: "https://ocr.example/ocr",
      init: {
        method: "POST",
        headers: { authorization: "Bearer ocr-key", "content-type": "multipart/form-data" },
        formFields: [
          { type: "text", name: "image_base64", value: "YWJj" },
          { type: "file", name: "file", fileName: "page.webp", mimeType: "image/webp", base64: "YWJj" },
        ],
      },
    },
    async (_url: string, init?: RequestInit) => {
      assert.equal(init?.body instanceof FormData, true);
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer ocr-key");
      assert.equal((init?.headers as Record<string, string>)["content-type"], undefined);
      return new Response("{\"words_result\":[]}", { status: 200, statusText: "OK" });
    },
  );

  assert.equal(response.ok, true);
  assert.equal(response.ok && response.bodyText, "{\"words_result\":[]}");
});
