import test from "node:test";
import assert from "node:assert/strict";
import { buildCacheKey, sha256Hex } from "./hashing.js";

test("creates deterministic sha256 hashes", () => {
  assert.equal(sha256Hex(Buffer.from("manga")), "05b44f4aa0e1b1de75c4ed641fb9c3c6b42b9186c59c78411bb1e2d34f26977e");
});

test("builds stable cache keys", () => {
  assert.equal(buildCacheKey({ imageHash: "abc", targetLanguage: "zh-CN", providerProfile: "mock", layoutVersion: 1 }), "img:abc:lang:zh-CN:provider:mock:layout:1");
});
