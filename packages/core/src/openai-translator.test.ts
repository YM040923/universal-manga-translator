import test from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleTextTranslator, parseTranslationResults } from "./openai-translator.js";

test("parseTranslationResults reads strict JSON item translations", () => {
  const results = parseTranslationResults('{"items":[{"id":"r1","translatedText":"你好"}]}', [{ id: "r1", text: "Hello" }]);
  assert.deepEqual(results, [{ id: "r1", translatedText: "你好" }]);
});

test("parseTranslationResults falls back to source text when model response is unusable", () => {
  const results = parseTranslationResults("not json", [{ id: "r1", text: "Hello" }]);
  assert.deepEqual(results, [{ id: "r1", translatedText: "Hello" }]);
});

test("OpenAICompatibleTextTranslator sends text-only chat completion request", async () => {
  let body: any;
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "gpt-test",
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const results = await translator.translate([{ id: "r1", text: "Hello" }], "zh-CN", "auto");

  assert.equal(body.model, "gpt-test");
  assert.equal(body.messages[0].role, "user");
  assert.match(body.messages[0].content, /Translate the following OCR text/);
  assert.match(body.messages[0].content, /proper names/i);
  assert.match(body.messages[0].content, /all-caps/i);
  assert.deepEqual(results, [{ id: "r1", translatedText: "你好" }]);
});

test("OpenAICompatibleTextTranslator lists models from OpenAI-compatible /models endpoint", async () => {
  let seenUrl = "";
  let seenAuthorization = "";
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "gpt-5.4-mini",
    fetch: async (url, init) => {
      seenUrl = String(url);
      seenAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({ data: [{ id: "gpt-5.4-mini" }, { id: "gpt-5.5" }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.deepEqual(await translator.listModels(), ["gpt-5.4-mini", "gpt-5.5"]);
  assert.equal(seenUrl, "https://api.example.test/v1/models");
  assert.equal(seenAuthorization, "Bearer key");
});

test("OpenAICompatibleTextTranslator retries transient fetch failures", async () => {
  let attempts = 0;
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "gpt-test",
    attempts: 2,
    retryDelayMs: 1,
    fetch: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("fetch failed");
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const results = await translator.translate([{ id: "r1", text: "Hello" }], "zh-CN", "auto");

  assert.equal(attempts, 2);
  assert.deepEqual(results, [{ id: "r1", translatedText: "你好" }]);
});

test("OpenAICompatibleTextTranslator retries Cloudflare 524 gateway timeouts", async () => {
  let attempts = 0;
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "gpt-test",
    attempts: 2,
    retryDelayMs: 1,
    fetch: async () => {
      attempts += 1;
      if (attempts === 1) return new Response("timeout", { status: 524 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"重试成功"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const results = await translator.translate([{ id: "r1", text: "Retry me" }], "zh-CN", "auto");

  assert.equal(attempts, 2);
  assert.deepEqual(results, [{ id: "r1", translatedText: "重试成功" }]);
});

test("OpenAICompatibleTextTranslator uses a manga localization prompt with name guidance", async () => {
  let prompt = "";
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "gpt-test",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      prompt = body.messages[0].content;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"小克拉克"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await translator.translate([{ id: "r1", text: "CLARK" }], "zh-CN", "auto");

  assert.match(prompt, /manga.*localization/i);
  assert.match(prompt, /speech bubbles/i);
  assert.match(prompt, /natural Chinese/i);
  assert.match(prompt, /proper names/i);
  assert.match(prompt, /do not translate.*names.*literally/i);
});

test("OpenAICompatibleTextTranslator can add retranslation improvement guidance", async () => {
  let prompt = "";
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "gpt-test",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      prompt = body.messages[0].content;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"重新润色"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await translator.translate([{ id: "r1", text: "Retry this" }], "zh-CN", "auto", { retranslate: true });

  assert.match(prompt, /retranslation/i);
  assert.match(prompt, /previous result may be poor/i);
  assert.match(prompt, /improve/i);
});
