import test from "node:test";
import assert from "node:assert/strict";
import { DirectClient } from "./direct-client.js";
import { DirectOcrCache } from "../cache/direct-ocr-cache.js";
import { ContentFingerprintCache } from "../cache/content-fingerprint-cache.js";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "../../settings/settings.js";

test("DirectClient reuses a completed content fingerprint when a signed image URL changes", async () => {
  let ocrCalls = 0;
  let translationCalls = 0;
  const storage = fakeStorage();
  const fetchImpl = (async (url, init) => {
    if (String(url).includes("ocr")) {
      ocrCalls += 1;
      return new Response(JSON.stringify({ words_result: [{ words: "HELLO", location: { left: 10, top: 20, width: 60, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    translationCalls += 1;
    const body = JSON.parse(String(init?.body));
    const prompt = String(body.messages[0].content);
    const item = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1)).items[0];
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ id: item.id, translatedText: "ÄãºÃ" }] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const shared = {
    __testFetch: fetchImpl,
    __testOcrCache: new DirectOcrCache(storage),
    __testContentCache: new ContentFingerprintCache(storage),
  };
  const first = new DirectClient(settings(shared));
  const second = new DirectClient(settings(shared));

  const firstResult = await first.submit(task("https://cdn.example/a.webp"));
  const secondResult = await second.submit(task("https://cdn.example/renewed.webp", "s2"));

  assert.equal(firstResult.ok && firstResult.result?.status, "completed");
  assert.equal(secondResult.ok && secondResult.result?.status, "cached");
  assert.equal(ocrCalls, 1);
  assert.equal(translationCalls, 1);
});

function settings(injections: Record<string, unknown>): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    targetLanguage: "zh-CN",
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["ocr-key"] },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-key", model: "gpt-test" },
    ...injections,
  } as ExtensionSettings;
}
function task(imageUrl: string, surfaceId = "s1") {
  return { surfaceId, pageUrl: "https://manga.example/ch/1", domain: "manga.example", imageUrl, imageData: "data:image/jpeg;base64,aW1hZ2U=", viewportPriority: "p0" as const, surfaceRect: { x: 0, y: 0, width: 100, height: 100 }, naturalSize: { width: 100, height: 100 }, renderSize: { width: 100, height: 100 }, readingDirection: "auto" as const, sourceLanguage: "auto", targetLanguage: "zh-CN" };
}
function fakeStorage() {
  const data: Record<string, unknown> = {};
  return { async get(key?: unknown) { if (typeof key === "string") return { [key]: data[key] }; return { ...data }; }, async set(value: Record<string, unknown>) { Object.assign(data, value); }, async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; } };
}