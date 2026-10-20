import test from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleTextTranslator, parseTranslationResults } from "./openai-translator.js";

test("parseTranslationResults reads strict JSON item translations", () => {
  const results = parseTranslationResults('{"items":[{"id":"r1","translatedText":"你好"}]}', [{ id: "r1", text: "Hello" }]);
  assert.deepEqual(results, [{ id: "r1", translatedText: "你好" }]);
});

test("parseTranslationResults rejects unusable or incomplete responses instead of treating source text as translated", () => {
  assert.throws(() => parseTranslationResults("not json", [{ id: "r1", text: "Hello" }]), /did not contain a JSON/i);
  assert.throws(() => parseTranslationResults('{"items":[]}', [{ id: "r1", text: "Hello" }]), /omitted 1 requested item/i);
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
  assert.equal(body.reasoning_effort, "none");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.temperature, undefined);
  assert.equal(body.messages[0].role, "user");
  assert.match(body.messages[0].content, /Translate the following OCR text/);
  assert.match(body.messages[0].content, /proper names/i);
  assert.match(body.messages[0].content, /all-caps/i);
  assert.deepEqual(results, [{ id: "r1", translatedText: "你好" }]);
});

test("OpenAICompatibleTextTranslator adapts when a provider rejects optional request parameters", async () => {
  const bodies: Array<Record<string, any>> = [];
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://fallback.example.test/v1",
    apiKey: "key",
    model: "fallback-test",
    attempts: 1,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.reasoning_effort !== undefined) {
        return new Response(JSON.stringify({ error: { message: "Unsupported parameter: reasoning_effort" } }), { status: 400, headers: { "content-type": "application/json" } });
      }
      if (body.response_format?.type === "json_schema") {
        return new Response(JSON.stringify({ error: { message: "json_schema is not supported" } }), { status: 400, headers: { "content-type": "application/json" } });
      }
      if (body.response_format?.type === "json_object") {
        return new Response(JSON.stringify({ error: { message: "response_format is not supported" } }), { status: 422, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await translator.translate([{ id: "r1", text: "Hello" }], "zh-CN", "auto");

  assert.deepEqual(result, [{ id: "r1", translatedText: "你好" }]);
  assert.equal(bodies.length, 4);
  assert.equal(bodies[0]?.reasoning_effort, "none");
  assert.equal(bodies[1]?.response_format.type, "json_schema");
  assert.equal(bodies[1]?.reasoning_effort, undefined);
  assert.deepEqual(bodies[2]?.response_format, { type: "json_object" });
  assert.equal(bodies[3]?.response_format, undefined);
});

test("OpenAICompatibleTextTranslator falls back to the lowest accepted reasoning effort", async () => {
  const efforts: unknown[] = [];
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://effort-fallback.example.test/v1",
    apiKey: "key",
    model: "effort-fallback-test",
    attempts: 1,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      efforts.push(body.reasoning_effort);
      if (body.reasoning_effort === "none") {
        return new Response(JSON.stringify({ error: { message: "Invalid reasoning_effort value 'none'. Supported values: minimal, low, medium." } }), { status: 400, headers: { "content-type": "application/json" } });
      }
      if (body.reasoning_effort === "minimal") {
        return new Response(JSON.stringify({ error: { message: "reasoning_effort value 'minimal' is not supported by this model." } }), { status: 422, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"r1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.deepEqual(
    await translator.translate([{ id: "r1", text: "Hello" }], "zh-CN", "auto"),
    [{ id: "r1", translatedText: "你好" }],
  );
  assert.deepEqual(efforts, ["none", "minimal", "low"]);
});

test("OpenAICompatibleTextTranslator accepts text content blocks in Chat Completions responses", async () => {
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://content-blocks.example.test/v1",
    apiKey: "key",
    model: "content-blocks-test",
    fetch: async () => new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: "text", text: '{"items":' }, { type: "text", text: '[{"id":"r1","translatedText":"你好"}]}' }] } }],
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.deepEqual(
    await translator.translate([{ id: "r1", text: "Hello" }], "zh-CN", "auto"),
    [{ id: "r1", translatedText: "你好" }],
  );
});

test("OpenAICompatibleTextTranslator includes provider error detail but redacts the API key", async () => {
  const translator = new OpenAICompatibleTextTranslator({
    baseUrl: "https://provider-errors.example.test/v1",
    apiKey: "secret-key",
    model: "error-test",
    attempts: 1,
    fetch: async () => new Response(JSON.stringify({ error: { message: "Quota exceeded for secret-key" } }), { status: 402, headers: { "content-type": "application/json" } }),
  });

  await assert.rejects(
    translator.translate([{ id: "r1", text: "Hello" }], "zh-CN", "auto"),
    (error: Error) => error.message.includes("HTTP 402") && error.message.includes("Quota exceeded") && !error.message.includes("secret-key"),
  );
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

  assert.match(prompt, /manga.*localization/i);
  assert.match(prompt, /speech bubbles/i);
  assert.match(prompt, /natural Chinese/i);
  assert.match(prompt, /proper names/i);
  assert.match(prompt, /do not translate.*names.*literally/i);
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

  assert.match(prompt, /First understand the whole page/i);
  assert.match(prompt, /Avoid literal word-by-word translation/i);
  assert.match(prompt, /not machine-translated/i);
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
  assert.match(prompt, /previous result may be poor/i);
  assert.match(prompt, /improve/i);
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
  assert.match(prompt, /mandatory/i);
  assert.match(prompt, /Clark/);
  assert.match(prompt, /克拉克/);
  assert.match(prompt, /Murim/);
  assert.match(prompt, /武林/);
  assert.match(prompt, /Do not rename/i);
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
  assert.match(prompt, /spoken Chinese/i);
  assert.match(prompt, /translationese/i);
  assert.match(prompt, /dialogue.*spoken Chinese/i);
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

  assert.match(prompt, /口语/);
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

  assert.match(prompt, /Auto-detected term candidates/i);
  assert.match(prompt, /Clark/);
  assert.match(prompt, /Heavenly Demon/);
});
