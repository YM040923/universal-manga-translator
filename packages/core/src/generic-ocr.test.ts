import test from "node:test";
import assert from "node:assert/strict";
import { GenericNetworkOcrClient, classifyGenericOcrError, getByPath, parseGenericOcrRegions } from "./generic-ocr.js";

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

test("GenericNetworkOcrClient posts image_base64 multipart with bearer key and static fields", async () => {
  let seenUrl = "";
  let seenAuthorization = "";
  const captured: { form?: FormData } = {};
  const client = new GenericNetworkOcrClient({
    endpoint: "https://ocr.example.test/ocr",
    apiKeys: ["secret-a"],
    inputMode: "image_base64",
    imageFieldName: "image_base64",
    staticFields: { need_location: true, lang: "en" },
    regionsPathCandidates: ["words_result"],
    textPathCandidates: ["words"],
    boxPathCandidates: ["location"],
    fetch: async (url, init) => {
      seenUrl = String(url);
      seenAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      captured.form = init?.body as FormData;
      return new Response(JSON.stringify({ words_result: [{ words: "OK", location: { left: 1, top: 2, width: 30, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const regions = await client.recognize({ imageBytes: new TextEncoder().encode("image") });

  assert.equal(seenUrl, "https://ocr.example.test/ocr");
  assert.equal(seenAuthorization, "Bearer secret-a");
  assert.equal(captured.form?.get("image_base64"), "aW1hZ2U=");
  assert.equal(captured.form?.get("image_name"), "surface.jpg");
  assert.equal(captured.form?.get("need_location"), "true");
  assert.equal(captured.form?.get("lang"), "en");
  assert.equal(regions[0]?.sourceText, "OK");
});

test("GenericNetworkOcrClient rotates keys on quota/auth/rate errors", async () => {
  const authorizations: string[] = [];
  const client = new GenericNetworkOcrClient({
    endpoint: "https://ocr.example.test/ocr",
    apiKeys: ["exhausted", "fresh"],
    attempts: 2,
    retryDelayMs: 1,
    regionsPathCandidates: ["words_result"],
    textPathCandidates: ["words"],
    boxPathCandidates: ["location"],
    fetch: async (_url, init) => {
      const authorization = new Headers(init?.headers).get("authorization") ?? "";
      authorizations.push(authorization);
      if (authorization === "Bearer exhausted") {
        return new Response(JSON.stringify({ code: "QUOTA_EXCEEDED", message: "quota exhausted" }), { status: 429, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ words_result: [{ words: "ROTATED", location: { left: 1, top: 2, width: 60, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const regions = await client.recognize({ imageBytes: new TextEncoder().encode("image") });

  assert.deepEqual(authorizations, ["Bearer exhausted", "Bearer fresh"]);
  assert.equal(regions[0]?.sourceText, "ROTATED");
  assert.equal(client.keyStatus().available, 1);
});

test("classifyGenericOcrError labels common provider failures", () => {
  assert.deepEqual(classifyGenericOcrError(new Error("Network OCR failed: 402 INSUFFICIENT_CREDITS 账户积分不足")), { kind: "quota", retryable: false });
  assert.deepEqual(classifyGenericOcrError(new Error("Network OCR failed: 401 INVALID_API_KEY")), { kind: "auth", retryable: false });
  assert.deepEqual(classifyGenericOcrError(new Error("Network OCR failed: 429 rate limit")), { kind: "rate_limit", retryable: true });
  assert.deepEqual(classifyGenericOcrError(new Error("fetch failed")), { kind: "network", retryable: true });
  assert.deepEqual(classifyGenericOcrError(new Error("Network OCR returned no text regions")), { kind: "empty", retryable: false });
});

test("GenericNetworkOcrClient tries all configured keys on quota even when retries are disabled", async () => {
  const authorizations: string[] = [];
  const client = new GenericNetworkOcrClient({
    endpoint: "https://ocr.example.test/ocr",
    apiKeys: ["empty-a", "empty-b", "fresh"],
    attempts: 1,
    retryDelayMs: 1,
    regionsPathCandidates: ["words_result"],
    textPathCandidates: ["words"],
    boxPathCandidates: ["location"],
    fetch: async (_url, init) => {
      const authorization = new Headers(init?.headers).get("authorization") ?? "";
      authorizations.push(authorization);
      if (authorization !== "Bearer fresh") {
        return new Response(JSON.stringify({ code: "INSUFFICIENT_CREDITS", message: "quota exhausted" }), { status: 402, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ words_result: [{ words: "OK", location: { left: 1, top: 2, width: 30, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const regions = await client.recognize({ imageBytes: new TextEncoder().encode("image") });

  assert.deepEqual(authorizations, ["Bearer empty-a", "Bearer empty-b", "Bearer fresh"]);
  assert.equal(regions[0]?.sourceText, "OK");
});
