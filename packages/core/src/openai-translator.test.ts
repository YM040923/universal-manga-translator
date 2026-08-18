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
  assert.match(body.messages[0].content, /Translate the OCR text below/);
  assert.match(body.messages[0].content, /proper names/i);
  assert.match(body.messages[0].content, /half-translated names/i);
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

test("OpenAICompatibleTextTranslator reports non-JSON HTML responses as base URL guidance", async () => {
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test",
    apiKey: "key",
    model: "gpt-test",
    fetch: async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }),
  });

  await assert.rejects(
    translator.translate([{ id: "r1", text: "Hello" }], "zh-CN", "auto"),
    /non-JSON response.*Base URL includes \/v1/i,
  );
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

  assert.match(prompt, /professional manga localizer/i);
  assert.match(prompt, /colloquial/i);
  assert.match(prompt, /natural, colloquial/i);
  assert.match(prompt, /proper names/i);
  assert.match(prompt, /Never output half-translated names/i);
});

test("OpenAICompatibleTextTranslator prompt discourages literal machine-translation style and uses page context", async () => {
  let prompt = "";
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "gpt-test",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      prompt = body.messages[0].content;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"克拉克在哪？"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await translator.translate([{ id: "r1", text: "Where is Clark?", context: "order 1/2; next: He went home." }], "zh-CN", "auto");

  assert.match(prompt, /RULES \(follow all\)/);
  assert.match(prompt, /NEVER translate word-by-word/i);
  assert.match(prompt, /machine translation, rewrite it/i);
  assert.match(prompt, /speaker intent/i);
  assert.match(prompt, /order 1\/2/);
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
  assert.match(prompt, /previous version was poor/i);
  assert.match(prompt, /rewrite the Chinese/i);
});

test("OpenAICompatibleTextTranslator prompt makes glossary terms mandatory and stable", async () => {
  let prompt = "";
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "gpt-test",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      prompt = body.messages[0].content;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"克拉克来自武林。"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await translator.translate(
    [{ id: "r1", text: "Clark came from Murim." }],
    "zh-CN",
    "auto",
    { glossary: { Clark: "克拉克", Murim: "武林" } },
  );

  assert.match(prompt, /User glossary/i);
  assert.match(prompt, /hard constraint/i);
  assert.match(prompt, /Clark/);
  assert.match(prompt, /克拉克/);
  assert.match(prompt, /Murim/);
  assert.match(prompt, /武林/);
  assert.match(prompt, /Never rename, reinterpret, or vary it/i);
});

test("OpenAICompatibleTextTranslator prompt includes chapter context and stronger natural manga style rules", async () => {
  let prompt = "";
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "gpt-test",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      prompt = body.messages[0].content;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"你到底想要什么？"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await translator.translate(
    [{ id: "r1", text: "What do you want?", context: "kind: dialogue" }],
    "zh-CN",
    "auto",
    { chapterContext: "Earlier: Clark is suspicious of the Heavenly Demon." },
  );

  assert.match(prompt, /Chapter context/i);
  assert.match(prompt, /Clark is suspicious/);
  assert.match(prompt, /spoken-language style/i);
  assert.match(prompt, /translationese/i);
  assert.match(prompt, /Dialogue must be short, emotional, spoken-language/i);
});


test("OpenAICompatibleTextTranslator prompt keeps Chinese style guidance readable", async () => {
  let prompt = "";
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "gpt-test",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      prompt = body.messages[0].content;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await translator.translate([{ id: "r1", text: "Hello" }], "zh-CN", "auto");

  // Chinese target includes a concrete zh example in the prompt.
  assert.match(prompt, /我都会保护好大家/);
  assert.doesNotMatch(prompt, /鍙|\uFFFD/);
});

test("OpenAICompatibleTextTranslator prompt includes auto term candidates for stable names", async () => {
  let prompt = "";
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "gpt-test",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      prompt = body.messages[0].content;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"克拉克"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await translator.translate(
    [{ id: "r1", text: "Clark meets Heavenly Demon" }],
    "zh-CN",
    "auto",
    { termCandidates: ["Clark", "Heavenly Demon"] },
  );

  assert.match(prompt, /Likely proper names on this page/i);
  assert.match(prompt, /Clark/);
  assert.match(prompt, /Heavenly Demon/);
});

test("OpenAICompatibleTextTranslator splits large batches into smaller requests", async () => {
  const requests: string[][] = [];
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "gpt-test",
    maxItemsPerRequest: 2,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const itemsPayload = JSON.parse(body.messages[0].content.split("\n").at(-1)).items as Array<{ id: string }>;
      requests.push(itemsPayload.map((item) => item.id));
      const ids = itemsPayload.map((item) => `{"id":"${item.id}","translatedText":"译${item.id}"}`);
      return new Response(JSON.stringify({ choices: [{ message: { content: `{"items":[${ids.join(",")}]}` } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const results = await translator.translate(
    [{ id: "r1", text: "a" }, { id: "r2", text: "b" }, { id: "r3", text: "c" }, { id: "r4", text: "d" }, { id: "r5", text: "e" }],
    "zh-CN",
    "auto",
  );

  assert.equal(requests.length, 3);
  assert.deepEqual(requests, [["r1", "r2"], ["r3", "r4"], ["r5"]]);
  assert.deepEqual(results.map((item) => item.id), ["r1", "r2", "r3", "r4", "r5"]);
});

test("OpenAICompatibleTextTranslator sends response_format json_object and retries without it on 400", async () => {
  const bodies: Array<{ response_format?: unknown }> = [];
  let calls = 0;
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "gpt-test",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: "response_format is not supported" } }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const results = await translator.translate([{ id: "r1", text: "Hello" }], "zh-CN", "auto");

  assert.equal(calls, 2);
  assert.deepEqual(bodies[0]?.response_format, { type: "json_object" });
  assert.equal(bodies[1]?.response_format, undefined);
  assert.deepEqual(results, [{ id: "r1", translatedText: "你好" }]);
});

test("OpenAICompatibleTextTranslator uses a balanced default temperature", async () => {
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

  await translator.translate([{ id: "r1", text: "Hello" }], "zh-CN", "auto");
  assert.equal(body.temperature, 0.4);
});
