import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIVisionProvider } from "./openai-vision-provider.js";

test("parses JSON regions from an OpenAI-compatible response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ regions: [{
      id: "r1",
      box: { x: 1, y: 2, width: 3, height: 4 },
      sourceText: "こんにちは",
      translatedText: "你好",
      confidence: 0.9,
      orientation: "vertical",
      kind: "dialogue",
    }] }) } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const provider = new OpenAIVisionProvider({ baseUrl: "https://api.example.test/v1", apiKey: "key", model: "vision", targetLanguage: "zh-CN" });
    const regions = await provider.process({
      task: {
        surfaceId: "s1",
        pageUrl: "https://example.test",
        domain: "example.test",
        viewportPriority: "p0",
        surfaceRect: { x: 0, y: 0, width: 10, height: 10 },
        naturalSize: { width: 10, height: 10 },
        renderSize: { width: 10, height: 10 },
        readingDirection: "auto",
        sourceLanguage: "auto",
        targetLanguage: "zh-CN",
      },
      imageBuffer: Buffer.from("abc"),
      imageHash: "hash",
      width: 10,
      height: 10,
    });
    assert.equal(regions[0]?.translatedText, "你好");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extracts fenced JSON from model response", () => {
  const parsed = OpenAIVisionProvider.parseRegionsFromContent("```json\n{\"regions\":[{\"id\":\"r1\",\"box\":{\"x\":0,\"y\":0,\"width\":10,\"height\":12},\"sourceText\":\"a\",\"translatedText\":\"b\",\"confidence\":1,\"orientation\":\"horizontal\",\"kind\":\"dialogue\"}]}\n```");
  assert.equal(parsed[0]?.translatedText, "b");
});

test("extracts JSON object from prefix and suffix text", () => {
  const parsed = OpenAIVisionProvider.parseRegionsFromContent("Here is the result {\"regions\":[]} thanks");
  assert.deepEqual(parsed, []);
});

test("can send nonstandard image field payload for compatible gateways", async () => {
  const originalFetch = globalThis.fetch;
  let body: any;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"regions\":[]}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = new OpenAIVisionProvider({ baseUrl: "https://api.example.test/v1", apiKey: "key", model: "vision", targetLanguage: "zh-CN", imageInputFormat: "image-field" });
    await provider.process({
      task: {
        surfaceId: "s1",
        pageUrl: "https://example.test",
        domain: "example.test",
        viewportPriority: "p0",
        surfaceRect: { x: 0, y: 0, width: 10, height: 10 },
        naturalSize: { width: 10, height: 10 },
        renderSize: { width: 10, height: 10 },
        readingDirection: "auto",
        sourceLanguage: "auto",
        targetLanguage: "zh-CN",
      },
      imageBuffer: Buffer.from("abc"),
      imageHash: "hash",
      width: 10,
      height: 10,
    });
    assert.equal(body.messages[0].content[1].type, "image");
    assert.match(body.messages[0].content[1].image, /^data:image\/jpeg;base64,/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("filters placeholder regions with empty text and 1x1 boxes", () => {
  const parsed = OpenAIVisionProvider.parseRegionsFromContent(JSON.stringify({ regions: [{
    id: "r1",
    box: { x: 0, y: 0, width: 1, height: 1 },
    sourceText: "",
    translatedText: "",
    confidence: 0.9,
    orientation: "horizontal",
    kind: "dialogue",
  }] }));
  assert.deepEqual(parsed, []);
});

test("provider prompt avoids empty placeholder region examples", async () => {
  const originalFetch = globalThis.fetch;
  let prompt = "";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    prompt = body.messages[0].content[0].text;
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"regions\":[]}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = new OpenAIVisionProvider({ baseUrl: "https://api.example.test/v1", apiKey: "key", model: "vision", targetLanguage: "zh-CN" });
    await provider.process({
      task: {
        surfaceId: "s1",
        pageUrl: "https://example.test",
        domain: "example.test",
        viewportPriority: "p0",
        surfaceRect: { x: 0, y: 0, width: 10, height: 10 },
        naturalSize: { width: 10, height: 10 },
        renderSize: { width: 10, height: 10 },
        readingDirection: "auto",
        sourceLanguage: "auto",
        targetLanguage: "zh-CN",
      },
      imageBuffer: Buffer.from("abc"),
      imageHash: "hash",
      width: 10,
      height: 10,
    });
    assert.equal(prompt.includes('"sourceText":""'), false);
    assert.equal(prompt.includes('"translatedText":""'), false);
    assert.match(prompt, /Return \{\"regions\":\[\]\}/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider prompt requests coordinates in the provided image coordinate space", async () => {
  const originalFetch = globalThis.fetch;
  let prompt = "";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    prompt = body.messages[0].content[0].text;
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"regions\":[]}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = new OpenAIVisionProvider({ baseUrl: "https://api.example.test/v1", apiKey: "key", model: "vision", targetLanguage: "zh-CN" });
    await provider.process({
      task: {
        surfaceId: "s1",
        pageUrl: "https://example.test",
        domain: "example.test",
        viewportPriority: "p0",
        surfaceRect: { x: 0, y: 0, width: 10, height: 10 },
        naturalSize: { width: 20, height: 20 },
        renderSize: { width: 10, height: 10 },
        readingDirection: "auto",
        sourceLanguage: "auto",
        targetLanguage: "zh-CN",
      },
      imageBuffer: Buffer.from("abc"),
      imageHash: "hash",
      width: 10,
      height: 10,
    });
    assert.match(prompt, /provided image pixels/i);
    assert.doesNotMatch(prompt, /original image pixels/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("repairs common non-strict JSON responses", () => {
  const content = `{ regions: [ { id: 'r1', box: { x: 1, y: 2, width: 30, height: 40, }, sourceText: 'こんにちは', translatedText: '你好', confidence: .9, orientation: 'horizontal', kind: 'dialogue', }, ], }`;
  const parsed = OpenAIVisionProvider.parseRegionsFromContent(content);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.translatedText, "你好");
});

test("parses bare region arrays from model responses", () => {
  const content = `[{"id":"r1","box":{"x":1,"y":2,"width":30,"height":40},"sourceText":"hi","translatedText":"你好","confidence":1,"orientation":"horizontal","kind":"dialogue"}]`;
  const parsed = OpenAIVisionProvider.parseRegionsFromContent(content);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.sourceText, "hi");
});

test("parseRegionsFromContent returns empty regions for unparseable model chatter", () => {
  const parsed = OpenAIVisionProvider.parseRegionsFromContent("I cannot help with that.");

  assert.deepEqual(parsed, []);
});
