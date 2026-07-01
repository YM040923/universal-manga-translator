import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManualOverrideStore } from "../cache/manual-overrides.js";
import { openDatabase } from "../cache/db.js";
import { SurfaceCache } from "../cache/surface-cache.js";
import { buildServer } from "./server.js";

const task = {
  surfaceId: "surface-1",
  pageUrl: "https://example.test/chapter/1",
  domain: "example.test",
  imageData: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iODAwIj48cmVjdCB3aWR0aD0iNjAwIiBoZWlnaHQ9IjgwMCIgZmlsbD0id2hpdGUiLz48dGV4dCB4PSIxMDAiIHk9IjEwMCI+SGVsbG88L3RleHQ+PC9zdmc+",
  viewportPriority: "p0",
  surfaceRect: { x: 0, y: 0, width: 600, height: 800 },
  naturalSize: { width: 600, height: 800 },
  renderSize: { width: 600, height: 800 },
  readingDirection: "auto",
  sourceLanguage: "auto",
  targetLanguage: "zh-CN",
} as const;

test("returns health information", async () => {
  const app = await buildServer({ provider: "mock", targetLanguage: "zh-CN" });
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, provider: "mock", targetLanguage: "zh-CN" });
  await app.close();
});

test("processes a submitted surface with mock provider", async () => {
  const app = await buildServer({ provider: "mock", targetLanguage: "zh-CN" });
  const response = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().result.regions[0].translatedText.length > 0, true);
  await app.close();
});

test("second identical submit is served from persistent cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-submit-cache-"));
  let db: ReturnType<typeof openDatabase> | undefined;
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  try {
    db = openDatabase(join(dir, "cache.sqlite"));
    const surfaceCache = new SurfaceCache(db);
    app = await buildServer({ provider: "mock", targetLanguage: "zh-CN", surfaceCache });
    const first = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task } });
    const second = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task: { ...task, surfaceId: "surface-2" } } });
    assert.equal(first.json().status, "completed");
    assert.equal(second.json().status, "cached");
    assert.equal(second.json().result.surfaceId, "surface-2");
  } finally {
    await app?.close();
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("submit returns structured failure and publishes job.failed", async () => {
  const events: string[] = [];
  const { EventBus } = await import("./events.js");
  const eventBus = new EventBus();
  eventBus.subscribe((event) => events.push(event.type));
  const app = await buildServer({
    provider: "mock",
    targetLanguage: "zh-CN",
    eventBus,
    visionProvider: { profile: "throwing", process: async () => { throw new Error("provider exploded"); } },
  });
  const response = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().result.status, "failed");
  assert.deepEqual(events.filter((type) => type.startsWith("job.")), ["job.queued", "job.processing", "job.failed"]);
  await app.close();
});

test("manual override API saves and applies edited text to submit results", async () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-override-api-"));
  let db: ReturnType<typeof openDatabase> | undefined;
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  try {
    db = openDatabase(join(dir, "cache.sqlite"));
    app = await buildServer({ provider: "mock", targetLanguage: "zh-CN", surfaceCache: new SurfaceCache(db), manualOverrideStore: new ManualOverrideStore(db) });
    const first = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task } });
    const imageHash = first.json().result.imageHash;

    const saved = await app.inject({ method: "POST", url: "/v1/overrides", payload: { imageHash, targetLanguage: "zh-CN", regionId: "r1", translatedText: "manual override" } });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().ok, true);

    const second = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task: { ...task, surfaceId: "surface-edited" } } });
    assert.equal(second.json().result.regions[0].translatedText, "manual override");
  } finally {
    await app?.close();
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("config status exposes provider details without leaking API key", async () => {
  const app = await buildServer({
    provider: "openai-compatible",
    targetLanguage: "zh-CN",
    visionProvider: { profile: "openai-compatible:gpt-4.1-mini", process: async () => [] },
    openAICompatibleBaseUrl: "https://api.openai.com/v1",
    openAIModel: "gpt-4.1-mini",
    openAIApiKeyConfigured: true,
  });

  const response = await app.inject({ method: "GET", url: "/v1/config/status" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    provider: "openai-compatible",
    targetLanguage: "zh-CN",
    providerProfile: "openai-compatible:gpt-4.1-mini",
    openAICompatible: {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      apiKeyConfigured: true,
    },
  });
  assert.equal(JSON.stringify(response.json()).includes("sk-"), false);
  await app.close();
});
