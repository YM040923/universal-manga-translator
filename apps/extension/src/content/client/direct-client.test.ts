import test from "node:test";
import assert from "node:assert/strict";
import type { SurfaceTask } from "@umt/shared/types";
import { DirectClient } from "./direct-client.js";
import type { ExtensionSettings } from "../../settings/settings.js";
import { DEFAULT_SETTINGS } from "../../settings/settings.js";
import { DirectOcrCache } from "../cache/direct-ocr-cache.js";

function task(overrides: Partial<SurfaceTask> = {}): SurfaceTask {
  return {
    surfaceId: "s1",
    pageUrl: "https://manga.example/chapter/1",
    domain: "manga.example",
    imageData: "data:image/jpeg;base64,aW1hZ2U=",
    viewportPriority: "p0",
    surfaceRect: { x: 0, y: 0, width: 100, height: 100 },
    naturalSize: { width: 100, height: 100 },
    renderSize: { width: 100, height: 100 },
    readingDirection: "auto",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
    ...overrides,
  };
}

function settings(fetchImpl: typeof fetch): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: {
      ...DEFAULT_SETTINGS.directOcr,
      apiUrl: "https://ocr.example/ocr",
      apiKeys: ["ocr-key"],
    },
    directTranslator: {
      baseUrl: "https://api.example/v1",
      apiKey: "llm-key",
      model: "gpt-test",
    },
    targetLanguage: "zh-CN",
    translationModel: "gpt-test",
    __testFetch: fetchImpl,
  } as ExtensionSettings & { __testFetch: typeof fetch };
}

function settingsWithCache(fetchImpl: typeof fetch, cache: DirectOcrCache): ExtensionSettings {
  return { ...settings(fetchImpl), __testOcrCache: cache } as ExtensionSettings & { __testFetch: typeof fetch; __testOcrCache: DirectOcrCache };
}

test("DirectClient submits imageData through OCR and translator", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("ocr")) {
      const auth = new Headers(init?.headers).get("authorization");
      assert.equal(auth, "Bearer ocr-key");
      return new Response(JSON.stringify({ words_result: [{ words: "HELLO", location: { left: 10, top: 20, width: 60, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const auth = new Headers(init?.headers).get("authorization");
    assert.equal(auth, "Bearer llm-key");
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"network-ocr-1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new DirectClient(settings(fetchImpl));

  const response = await client.submit(task(), "job-1");

  assert.equal(response.ok, true);
  assert.equal(response.surfaceId, "s1");
  assert.equal(response.status, "completed");
  assert.equal(response.result?.regions[0]?.translatedText, "你好");
  assert.equal(response.result?.regions[0]?.box.x, 10);
  assert.deepEqual(calls, ["https://ocr.example/ocr", "https://api.example/v1/chat/completions"]);
});

test("DirectClient rejects tasks without imageData with a clear error", async () => {
  const client = new DirectClient(settings((async () => { throw new Error("must not fetch"); }) as typeof fetch));

  const noImageTask = task();
  delete noImageTask.imageData;
  const response = await client.submit(noImageTask);

  assert.equal(response.ok, false);
  assert.match(response.error, /imageData.*required/i);
});

test("DirectClient selfTest reports missing configuration", async () => {
  const client = new DirectClient({ ...DEFAULT_SETTINGS, runMode: "direct" });

  const response = await client.selfTest();

  assert.equal(response.ok, true);
  assert.equal(response.steps.some((step: { name: string; ok: boolean }) => step.name === "ocr-config" && !step.ok), true);
  assert.equal(response.steps.some((step: { name: string; ok: boolean }) => step.name === "translator-config" && !step.ok), true);
});

test("DirectClient reuses OCR cache when retranslating the same image", async () => {
  let ocrCalls = 0;
  let translatorCalls = 0;
  const cache = new DirectOcrCache(fakeStorage());
  const fetchImpl = (async (url) => {
    if (String(url).includes("ocr")) {
      ocrCalls += 1;
      return new Response(JSON.stringify({ words_result: [{ words: "HELLO", location: { left: 10, top: 20, width: 60, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    translatorCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"network-ocr-1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new DirectClient(settingsWithCache(fetchImpl, cache));

  await client.submit(task());
  await client.retranslate(task());

  assert.equal(ocrCalls, 1);
  assert.equal(translatorCalls, 2);
  assert.equal((await client.cacheStats()).ok, true);
});

test("DirectClient clearCache clears direct OCR cache entries", async () => {
  const cache = new DirectOcrCache(fakeStorage());
  await cache.set("key", [{
    id: "r1",
    box: { x: 1, y: 2, width: 3, height: 4 },
    sourceText: "HELLO",
    confidence: 1,
    orientation: "horizontal",
    kind: "dialogue",
  }]);
  const client = new DirectClient(settingsWithCache((async () => { throw new Error("must not fetch"); }) as typeof fetch, cache));

  const response = await client.clearCache();

  assert.equal(response.ok, true);
  assert.equal(response.ok && response.deleted, 1);
});

function fakeStorage() {
  const data: Record<string, unknown> = {};
  return {
    async get(key?: unknown) {
      if (typeof key === "string") return { [key]: data[key] };
      return { ...data };
    },
    async set(value: Record<string, unknown>) { Object.assign(data, value); },
    async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
}
