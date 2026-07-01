import test from "node:test";
import assert from "node:assert/strict";
import { BackendClient, createEventUrl, SurfaceSubmitTracker } from "./backend-client.js";

test("createEventUrl converts http backend url to websocket events url", () => {
  assert.equal(createEventUrl("http://127.0.0.1:47831"), "ws://127.0.0.1:47831/v1/events");
  assert.equal(createEventUrl("https://example.test/base/"), "wss://example.test/base/v1/events");
});

test("SurfaceSubmitTracker prevents duplicate surface submissions", () => {
  const tracker = new SurfaceSubmitTracker();
  assert.equal(tracker.shouldSubmit("s1"), true);
  tracker.markSubmitted("s1");
  assert.equal(tracker.shouldSubmit("s1"), false);
  tracker.clear();
  assert.equal(tracker.shouldSubmit("s1"), true);
});

test("BackendClient exposes events url", () => {
  assert.equal(new BackendClient("http://127.0.0.1:47831").eventsUrl(), "ws://127.0.0.1:47831/v1/events");
});

test("BackendClient saves manual override", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true, override: JSON.parse(String(init?.body)) }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const response = await new BackendClient("http://127.0.0.1:47831").saveManualOverride({ imageHash: "hash", targetLanguage: "zh-CN", regionId: "r1", translatedText: "manual edit" });

  assert.equal(response.ok, true);
  assert.equal(calls[0]?.url, "http://127.0.0.1:47831/v1/overrides");
  assert.equal(calls[0]?.init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { imageHash: "hash", targetLanguage: "zh-CN", regionId: "r1", translatedText: "manual edit" });
});
