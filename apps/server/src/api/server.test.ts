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



test("empty provider results are not reused as cache hits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-empty-cache-"));
  let db: ReturnType<typeof openDatabase> | undefined;
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  let calls = 0;
  try {
    db = openDatabase(join(dir, "cache.sqlite"));
    app = await buildServer({
      provider: "test",
      targetLanguage: "zh-CN",
      surfaceCache: new SurfaceCache(db),
      visionProvider: {
        profile: "empty-then-complete",
        process: async () => {
          calls += 1;
          if (calls === 1) return [];
          return [{ id: "r1", box: { x: 10, y: 10, width: 100, height: 50 }, sourceText: "hi", translatedText: "??", confidence: 1, orientation: "horizontal", kind: "dialogue" }];
        },
      },
    });

    const first = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task } });
    const second = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task: { ...task, surfaceId: "surface-retry" } } });

    assert.equal(first.json().status, "empty");
    assert.equal(second.json().status, "completed");
    assert.equal(second.json().result.regions.length, 1);
    assert.equal(calls, 2);
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
    openAIImageInputFormat: "image-field",
    maxImageLongEdge: 1600,
    jpegQuality: 0.75,
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
      imageInputFormat: "image-field",
    },
    image: {
      maxLongEdge: 1600,
      jpegQuality: 0.75,
    },
    configWritable: false,
  });
  assert.equal(JSON.stringify(response.json()).includes("sk-"), false);
  await app.close();
});

test("models endpoint exposes provider model list and current model", async () => {
  const app = await buildServer({
    provider: "openai-compatible",
    targetLanguage: "zh-CN",
    openAIModel: "gpt-5.4-mini",
    visionProvider: { profile: "openai-compatible:gpt-5.4-mini", listModels: async () => ["gpt-5.4-mini", "gpt-5.5"], process: async () => [] },
  });

  const response = await app.inject({ method: "GET", url: "/v1/models" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, models: ["gpt-5.4-mini", "gpt-5.5"], currentModel: "gpt-5.4-mini" });
  await app.close();
});

test("clear diagnostics endpoint calls diagnostics clearer", async () => {
  let called = false;
  const app = await buildServer({
    provider: "mock",
    targetLanguage: "zh-CN",
    diagnosticsClearer: () => { called = true; return 123; },
  });

  const response = await app.inject({ method: "POST", url: "/v1/diagnostics/clear" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, deleted: 123 });
  assert.equal(called, true);
  await app.close();
});

test("cache management API reports stats and clears cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-cache-api-"));
  let db: ReturnType<typeof openDatabase> | undefined;
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  try {
    db = openDatabase(join(dir, "cache.sqlite"));
    app = await buildServer({ provider: "mock", targetLanguage: "zh-CN", surfaceCache: new SurfaceCache(db) });
    await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task } });

    const stats = await app.inject({ method: "GET", url: "/v1/cache/stats" });
    assert.equal(stats.statusCode, 200);
    assert.equal(stats.json().ok, true);
    assert.equal(stats.json().stats.entries, 1);

    const cleared = await app.inject({ method: "POST", url: "/v1/cache/clear" });
    assert.equal(cleared.statusCode, 200);
    assert.equal(cleared.json().ok, true);
    assert.equal(cleared.json().deleted, 1);
  } finally {
    await app?.close();
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retranslate bypasses cache and cancel returns accepted status", async () => {
  let calls = 0;
  const app = await buildServer({
    provider: "mock",
    targetLanguage: "zh-CN",
    visionProvider: {
      profile: "counting",
      process: async () => {
        calls += 1;
        return [{ id: "r1", box: { x: 0, y: 0, width: 10, height: 10 }, sourceText: "hi", translatedText: `translated ${calls}`, confidence: 1, orientation: "horizontal", kind: "dialogue" }];
      },
    },
  });

  const first = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task } });
  const second = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task: { ...task, surfaceId: "cached-surface" } } });
  const third = await app.inject({ method: "POST", url: "/v1/surfaces/retranslate", payload: { task: { ...task, surfaceId: "retranslated-surface" } } });
  const cancelled = await app.inject({ method: "POST", url: "/v1/surfaces/cancel", payload: { surfaceId: "retranslated-surface" } });

  assert.equal(first.json().status, "completed");
  assert.equal(second.json().status, "cached");
  assert.equal(third.statusCode, 200);
  assert.equal(third.json().status, "completed");
  assert.equal(third.json().result.regions[0].translatedText, "translated 2");
  assert.equal(cancelled.statusCode, 200);
  assert.deepEqual(cancelled.json(), { ok: true, surfaceId: "retranslated-surface", status: "accepted", cancellable: false });
  await app.close();
});
test("submit maps provider boxes from normalized provider image back to original image pixels", async () => {
  const sharp = await import("sharp");
  const largeImage = await sharp.default({ create: { width: 2000, height: 1000, channels: 3, background: "white" } }).png().toBuffer();
  const largeTask = {
    ...task,
    imageData: `data:image/png;base64,${largeImage.toString("base64")}`,
    naturalSize: { width: 2000, height: 1000 },
    renderSize: { width: 1000, height: 500 },
    surfaceRect: { x: 0, y: 0, width: 1000, height: 500 },
  };
  const app = await buildServer({
    provider: "test",
    targetLanguage: "zh-CN",
    maxImageLongEdge: 1000,
    visionProvider: {
      profile: "box-provider",
      process: async (input) => {
        assert.equal(input.width, 1000);
        assert.equal(input.height, 500);
        return [{ id: "r1", box: { x: 100, y: 50, width: 200, height: 100 }, sourceText: "hi", translatedText: "你好", confidence: 1, orientation: "horizontal", kind: "dialogue" }];
      },
    },
  });

  const response = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task: largeTask } });

  assert.deepEqual(response.json().result.regions[0].box, { x: 200, y: 100, width: 400, height: 200 });
  await app.close();
});

test("submit tiles very tall webtoon images instead of shrinking text unreadably", async () => {
  const sharp = await import("sharp");
  const tallImage = await sharp.default({ create: { width: 900, height: 4000, channels: 3, background: "white" } }).png().toBuffer();
  const tallTask = {
    ...task,
    imageData: `data:image/png;base64,${tallImage.toString("base64")}`,
    naturalSize: { width: 900, height: 4000 },
    renderSize: { width: 450, height: 2000 },
    surfaceRect: { x: 0, y: 0, width: 450, height: 2000 },
  };
  const seen: Array<{ width: number; height: number }> = [];
  const app = await buildServer({
    provider: "test",
    targetLanguage: "zh-CN",
    maxImageLongEdge: 1600,
    visionProvider: {
      profile: "tile-provider",
      process: async (input) => {
        seen.push({ width: input.width, height: input.height });
        return [{ id: `r${seen.length}`, box: { x: 90, y: 100, width: 180, height: 80 }, sourceText: "hi", translatedText: "你好", confidence: 1, orientation: "horizontal", kind: "dialogue" }];
      },
    },
  });

  const response = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task: tallTask } });

  assert.equal(response.statusCode, 200);
  assert.equal(seen.length > 1, true);
  assert.equal(seen.every((size) => size.width >= 800), true);
  assert.equal(response.json().result.regions.length, seen.length);
  assert.equal(response.json().result.regions[1].box.y > response.json().result.regions[0].box.y, true);
  await app.close();
});

test("diagnostics API returns recent safe records", async () => {
  const records: unknown[] = [{ surfaceId: "s1", status: "empty" }];
  const app = await buildServer({
    provider: "mock",
    targetLanguage: "zh-CN",
    diagnosticsReader: () => records as Array<Record<string, unknown>>,
  });

  const response = await app.inject({ method: "GET", url: "/v1/diagnostics/recent?limit=5" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, records });
  await app.close();
});


test("submit clamps provider boxes to original image bounds and filters unusable boxes", async () => {
  const app = await buildServer({
    provider: "test",
    targetLanguage: "zh-CN",
    visionProvider: {
      profile: "bounds-provider",
      process: async () => [
        { id: "r1", box: { x: -10, y: 10, width: 40, height: 30 }, sourceText: "hi", translatedText: "你好", confidence: 1, orientation: "horizontal", kind: "dialogue" },
        { id: "r2", box: { x: 2000, y: 2000, width: 10, height: 10 }, sourceText: "bad", translatedText: "坏", confidence: 1, orientation: "horizontal", kind: "dialogue" },
      ],
    },
  });

  const response = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "completed");
  assert.deepEqual(response.json().result.regions.map((region: any) => region.id), ["r1"]);
  assert.deepEqual(response.json().result.regions[0].box, { x: 0, y: 10, width: 30, height: 30 });
  await app.close();
});


test("diagnostics note distinguishes provider-empty from all boxes filtered", async () => {
  const records: Array<Record<string, unknown>> = [];
  const app = await buildServer({
    provider: "test",
    targetLanguage: "zh-CN",
    diagnosticsWriter: { record: (record) => records.push(record as unknown as Record<string, unknown>) },
    visionProvider: {
      profile: "empty-provider",
      process: async () => [],
    },
  });

  await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task: { ...task, surfaceId: "provider-empty" } } });

  assert.equal(records.at(-1)?.note, "no-regions-from-provider");
  await app.close();
});

test("diagnostics note marks all provider boxes filtered", async () => {
  const records: Array<Record<string, unknown>> = [];
  const app = await buildServer({
    provider: "test",
    targetLanguage: "zh-CN",
    diagnosticsWriter: { record: (record) => records.push(record as unknown as Record<string, unknown>) },
    visionProvider: {
      profile: "bad-box-provider",
      process: async () => [{ id: "r1", box: { x: 9999, y: 9999, width: 10, height: 10 }, sourceText: "bad", translatedText: "坏", confidence: 1, orientation: "horizontal", kind: "dialogue" }],
    },
  });

  await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task: { ...task, surfaceId: "all-filtered" } } });

  assert.equal(records.at(-1)?.note, "all-boxes-filtered");
  assert.equal(records.at(-1)?.filteredRegionCount, 1);
  await app.close();
});

test("self test endpoint verifies provider submit flow", async () => {
  const app = await buildServer({
    provider: "mock",
    targetLanguage: "zh-CN",
    visionProvider: { profile: "mock", process: async () => [{ id: "r1", box: { x: 10, y: 10, width: 100, height: 50 }, sourceText: "Hello", translatedText: "你好", confidence: 1, orientation: "horizontal", kind: "dialogue" }] },
  });

  const response = await app.inject({ method: "POST", url: "/v1/self-test" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().provider, "mock");
  assert.equal(response.json().providerProfile, "mock");
  assert.equal(response.json().sample.status, "completed");
  assert.equal(response.json().sample.regionCount, 1);
  assert.deepEqual(response.json().steps.map((step: any) => step.name), ["backend", "provider", "sample-submit", "regions"]);
  await app.close();
});
