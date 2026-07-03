import test from "node:test";
import assert from "node:assert/strict";
import { GenericNetworkOcrProvider, parseGenericOcrRegions, getByPath } from "./generic-network-ocr-provider.js";
import type { ProviderInput } from "./provider.js";

test("getByPath reads nested dot paths and array indexes", () => {
  assert.equal(getByPath({ data: { items: [{ text: "hello" }] } }, "data.items.0.text"), "hello");
  assert.equal(getByPath({ data: { items: [{ text: "hello" }] } }, "data.items.1.text"), undefined);
});

test("parseGenericOcrRegions maps words_result location with configurable paths", () => {
  const regions = parseGenericOcrRegions({
    words_result: [{ words: "HELLO", location: { left: 10, top: 20, width: 90, height: 24 }, score: 0.96 }],
  }, {
    regionsPathCandidates: ["words_result"],
    textPathCandidates: ["words", "text"],
    boxPathCandidates: ["location", "box"],
    confidencePathCandidates: ["score"],
  });

  assert.deepEqual(regions.map((region) => ({ text: region.sourceText, box: region.box, confidence: region.confidence })), [
    { text: "HELLO", box: { x: 10, y: 20, width: 90, height: 24 }, confidence: 0.96 },
  ]);
});

test("parseGenericOcrRegions maps data.words_result text plus polygon box", () => {
  const regions = parseGenericOcrRegions({
    data: { words_result: [{ text: "POLY", box: [[5, 8], [45, 8], [45, 28], [5, 28]], confidence: 0.8 }] },
  }, {
    regionsPathCandidates: ["data.words_result"],
    textPathCandidates: ["text"],
    boxPathCandidates: ["box"],
    confidencePathCandidates: ["confidence"],
  });

  assert.deepEqual(regions[0]?.box, { x: 5, y: 8, width: 40, height: 20 });
  assert.equal(regions[0]?.sourceText, "POLY");
});

test("GenericNetworkOcrProvider posts image_base64 multipart with bearer key and static fields", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenAuthorization = "";
  const captured: { form?: FormData } = {};
  globalThis.fetch = (async (url, init) => {
    seenUrl = String(url);
    seenAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    captured.form = init?.body as FormData;
    return new Response(JSON.stringify({ words_result: [{ words: "OK", location: { left: 1, top: 2, width: 30, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const provider = new GenericNetworkOcrProvider({
      endpoint: "https://ocr.example.test/ocr",
      apiKeys: ["secret-a"],
      inputMode: "image_base64",
      imageFieldName: "image_base64",
      staticFields: { need_location: true, lang: "en" },
      regionsPathCandidates: ["words_result"],
      textPathCandidates: ["words"],
      boxPathCandidates: ["location"],
    });

    const regions = await provider.recognize(fakeInput());

    assert.equal(seenUrl, "https://ocr.example.test/ocr");
    assert.equal(seenAuthorization, "Bearer secret-a");
    assert.equal(captured.form?.get("image_base64"), Buffer.from("image").toString("base64"));
    assert.equal(captured.form?.get("image_name"), "surface.jpg");
    assert.equal(captured.form?.get("need_location"), "true");
    assert.equal(captured.form?.get("lang"), "en");
    assert.equal(regions[0]?.sourceText, "OK");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GenericNetworkOcrProvider rotates keys on quota/auth/rate errors", async () => {
  const originalFetch = globalThis.fetch;
  const authorizations: string[] = [];
  globalThis.fetch = (async (_url, init) => {
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    authorizations.push(authorization);
    if (authorization === "Bearer exhausted") {
      return new Response(JSON.stringify({ code: "QUOTA_EXCEEDED", message: "quota exhausted" }), { status: 429, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ words_result: [{ words: "ROTATED", location: { left: 1, top: 2, width: 60, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const provider = new GenericNetworkOcrProvider({
      endpoint: "https://ocr.example.test/ocr",
      apiKeys: ["exhausted", "fresh"],
      attempts: 2,
      retryDelayMs: 1,
      regionsPathCandidates: ["words_result"],
      textPathCandidates: ["words"],
      boxPathCandidates: ["location"],
    });

    const regions = await provider.recognize(fakeInput());

    assert.deepEqual(authorizations, ["Bearer exhausted", "Bearer fresh"]);
    assert.equal(regions[0]?.sourceText, "ROTATED");
    assert.equal(provider.keyStatus().available, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function fakeInput(): ProviderInput {
  return {
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
    imageBuffer: Buffer.from("image"),
    imageHash: "hash",
    width: 10,
    height: 10,
  };
}
