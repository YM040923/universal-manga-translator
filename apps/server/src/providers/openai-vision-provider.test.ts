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
  const parsed = OpenAIVisionProvider.parseRegionsFromContent("```json\n{\"regions\":[{\"id\":\"r1\",\"box\":{\"x\":0,\"y\":0,\"width\":1,\"height\":1},\"sourceText\":\"a\",\"translatedText\":\"b\",\"confidence\":1,\"orientation\":\"horizontal\",\"kind\":\"dialogue\"}]}\n```");
  assert.equal(parsed[0]?.translatedText, "b");
});

test("extracts JSON object from prefix and suffix text", () => {
  const parsed = OpenAIVisionProvider.parseRegionsFromContent("Here is the result {\"regions\":[]} thanks");
  assert.deepEqual(parsed, []);
});
