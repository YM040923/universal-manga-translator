import test from "node:test";
import assert from "node:assert/strict";
import { OpenAITextTranslator, parseTranslationResults } from "./openai-text-translator.js";

test("parseTranslationResults reads strict JSON item translations", () => {
  const results = parseTranslationResults('{"items":[{"id":"r1","translatedText":"你好"}]}', [{ id: "r1", text: "Hello" }]);

  assert.deepEqual(results, [{ id: "r1", translatedText: "你好" }]);
});

test("parseTranslationResults falls back to source text when model response is unusable", () => {
  const results = parseTranslationResults("not json", [{ id: "r1", text: "Hello" }]);

  assert.deepEqual(results, [{ id: "r1", translatedText: "Hello" }]);
});

test("OpenAITextTranslator sends text-only chat completion request", async () => {
  const originalFetch = globalThis.fetch;
  let body: any;
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const translator = new OpenAITextTranslator({ baseUrl: "https://api.example.test/v1", apiKey: "key", model: "gpt-test" });
    const results = await translator.translate([{ id: "r1", text: "Hello" }], "zh-CN", "auto");

    assert.equal(body.model, "gpt-test");
    assert.equal(body.messages[0].role, "user");
    assert.match(body.messages[0].content, /Translate the following OCR text/);
    assert.match(body.messages[0].content, /proper names/i);
    assert.match(body.messages[0].content, /all-caps/i);
    assert.deepEqual(results, [{ id: "r1", translatedText: "你好" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAITextTranslator lists models from OpenAI-compatible /models endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenAuthorization = "";
  globalThis.fetch = (async (url, init) => {
    seenUrl = String(url);
    seenAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ data: [{ id: "gpt-5.4-mini" }, { id: "gpt-5.5" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const translator = new OpenAITextTranslator({ baseUrl: "https://api.example.test/v1", apiKey: "key", model: "gpt-5.4-mini" });

    assert.deepEqual(await translator.listModels(), ["gpt-5.4-mini", "gpt-5.5"]);
    assert.equal(seenUrl, "https://api.example.test/v1/models");
    assert.equal(seenAuthorization, "Bearer key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAITextTranslator retries transient fetch failures", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("fetch failed");
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const translator = new OpenAITextTranslator({ baseUrl: "https://api.example.test/v1", apiKey: "key", model: "gpt-test", attempts: 2, retryDelayMs: 1 });
    const results = await translator.translate([{ id: "r1", text: "Hello" }], "zh-CN", "auto");

    assert.equal(attempts, 2);
    assert.deepEqual(results, [{ id: "r1", translatedText: "你好" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAITextTranslator retries Cloudflare 524 gateway timeouts", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts === 1) return new Response("timeout", { status: 524 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"閲嶈瘯鎴愬姛"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const translator = new OpenAITextTranslator({ baseUrl: "https://api.example.test/v1", apiKey: "key", model: "gpt-test", attempts: 2, retryDelayMs: 1 });
    const results = await translator.translate([{ id: "r1", text: "Retry me" }], "zh-CN", "auto");

    assert.equal(attempts, 2);
    assert.deepEqual(results, [{ id: "r1", translatedText: "閲嶈瘯鎴愬姛" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAITextTranslator uses a manga localization prompt with name guidance", async () => {
  const originalFetch = globalThis.fetch;
  let prompt = "";
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    prompt = body.messages[0].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"小克拉克"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const translator = new OpenAITextTranslator({ baseUrl: "https://api.example.test/v1", apiKey: "key", model: "gpt-test" });
    await translator.translate([{ id: "r1", text: "CLARK" }], "zh-CN", "auto");

    assert.match(prompt, /manga.*localization/i);
    assert.match(prompt, /speech bubbles/i);
    assert.match(prompt, /natural Chinese/i);
    assert.match(prompt, /proper names/i);
    assert.match(prompt, /do not translate.*names.*literally/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAITextTranslator can add retranslation improvement guidance", async () => {
  const originalFetch = globalThis.fetch;
  let prompt = "";
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    prompt = body.messages[0].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"重新润色"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const translator = new OpenAITextTranslator({ baseUrl: "https://api.example.test/v1", apiKey: "key", model: "gpt-test" });
    await translator.translate([{ id: "r1", text: "Retry this" }], "zh-CN", "auto", { retranslate: true });

    assert.match(prompt, /retranslation/i);
    assert.match(prompt, /previous result may be poor/i);
    assert.match(prompt, /improve/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
