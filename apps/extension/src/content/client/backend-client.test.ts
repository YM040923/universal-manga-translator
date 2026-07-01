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

test("BackendClient reads sanitized provider config status", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify({
      ok: true,
      provider: "openai-compatible",
      targetLanguage: "zh-CN",
      providerProfile: "openai-compatible:gpt-4.1-mini",
      openAICompatible: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", apiKeyConfigured: true },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const status = await new BackendClient("http://127.0.0.1:47831").configStatus();

  assert.equal(calls[0], "http://127.0.0.1:47831/v1/config/status");
  assert.equal(status.ok, true);
  assert.equal(status.ok && status.openAICompatible.apiKeyConfigured, true);
});

test("BackendClient calls cache management and task control endpoints", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).endsWith("/v1/cache/stats")) return new Response(JSON.stringify({ ok: true, stats: { entries: 1, bytes: 10, updatedAt: 123 } }), { status: 200 });
    if (String(url).endsWith("/v1/cache/clear")) return new Response(JSON.stringify({ ok: true, deleted: 1 }), { status: 200 });
    if (String(url).endsWith("/v1/surfaces/cancel")) return new Response(JSON.stringify({ ok: true, surfaceId: "s1", status: "accepted", cancellable: false }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, surfaceId: "s1", status: "completed" }), { status: 200 });
  }) as typeof fetch;
  const client = new BackendClient("http://127.0.0.1:47831");

  await client.cacheStats();
  await client.clearCache();
  await client.cancelSurface("s1");

  assert.equal(calls[0]?.url, "http://127.0.0.1:47831/v1/cache/stats");
  assert.equal(calls[1]?.url, "http://127.0.0.1:47831/v1/cache/clear");
  assert.equal(calls[1]?.init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[2]?.init.body)), { surfaceId: "s1" });
});

test("BackendClient reads recent diagnostics", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ ok: true, records: [{ surfaceId: "s1", status: "empty" }] }), { status: 200 });
  }) as typeof fetch;

  const response = await new BackendClient("http://127.0.0.1:47831").recentDiagnostics(5);

  assert.equal(calls[0], "http://127.0.0.1:47831/v1/diagnostics/recent?limit=5");
  assert.equal(response.ok, true);
  assert.equal(response.ok && response.records[0]?.surfaceId, "s1");
});


test("BackendClient retries transient submit failures", async () => {
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary network failure");
    return new Response(JSON.stringify({ ok: true, surfaceId: "s1", status: "completed" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const response = await new BackendClient("http://127.0.0.1:47831", { retryCount: 1 }).submit(fakeTask());

  assert.equal(response.ok, true);
  assert.equal(attempts, 2);
});

test("BackendClient passes an AbortSignal for timed submit requests", async () => {
  let signalSeen = false;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    signalSeen = init?.signal instanceof AbortSignal;
    return new Response(JSON.stringify({ ok: true, surfaceId: "s1", status: "completed" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  await new BackendClient("http://127.0.0.1:47831", { timeoutMs: 5000 }).submit(fakeTask());

  assert.equal(signalSeen, true);
});

function fakeTask() {
  return {
    surfaceId: "s1",
    pageUrl: "https://example.test/chapter/1",
    domain: "example.test",
    imageData: "data:image/png;base64,abc",
    viewportPriority: "p0" as const,
    surfaceRect: { x: 0, y: 0, width: 100, height: 100 },
    naturalSize: { width: 100, height: 100 },
    renderSize: { width: 100, height: 100 },
    readingDirection: "auto" as const,
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
  };
}


test("BackendClient runs backend self test", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      ok: true,
      provider: "mock",
      providerProfile: "mock",
      targetLanguage: "zh-CN",
      steps: [{ name: "backend", ok: true, detail: "ok" }],
      sample: { status: "completed", regionCount: 1, elapsedMs: 12 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const response = await new BackendClient("http://127.0.0.1:47831").selfTest();

  assert.equal(calls[0]?.url, "http://127.0.0.1:47831/v1/self-test");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(response.ok && response.sample.regionCount, 1);
});


test("SurfaceSubmitTracker can release a surface for later retry", () => {
  const tracker = new SurfaceSubmitTracker();
  tracker.markSubmitted("s1");
  assert.equal(tracker.shouldSubmit("s1"), false);

  tracker.release("s1");

  assert.equal(tracker.shouldSubmit("s1"), true);
});
