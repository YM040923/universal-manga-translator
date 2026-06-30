import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(response.json().result.regions[0].translatedText, "测试译文");
  await app.close();
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../cache/db.js";
import { SurfaceCache } from "../cache/surface-cache.js";

test("second identical submit is served from persistent cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-submit-cache-"));
  try {
    const surfaceCache = new SurfaceCache(openDatabase(join(dir, "cache.sqlite")));
    const app = await buildServer({ provider: "mock", targetLanguage: "zh-CN", surfaceCache });
    const first = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task } });
    const second = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task: { ...task, surfaceId: "surface-2" } } });
    assert.equal(first.json().status, "completed");
    assert.equal(second.json().status, "cached");
    assert.equal(second.json().result.surfaceId, "surface-2");
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
