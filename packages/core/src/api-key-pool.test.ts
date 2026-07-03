import test from "node:test";
import assert from "node:assert/strict";
import { ApiKeyPool } from "./api-key-pool.js";

test("ApiKeyPool rotates keys without exposing secrets", () => {
  const pool = new ApiKeyPool(["test-key-a", "test-key-b"]);

  const first = pool.next();
  const second = pool.next();
  const third = pool.next();

  assert.equal(first?.value, "test-key-a");
  assert.equal(first?.label, "key#1");
  assert.equal(second?.value, "test-key-b");
  assert.equal(second?.label, "key#2");
  assert.equal(third?.value, "test-key-a");
  assert.equal(JSON.stringify(pool.status()).includes("uapi-"), false);
});

test("ApiKeyPool skips failed keys until reset", () => {
  const pool = new ApiKeyPool(["k1", "k2", "k3"]);

  const first = pool.next()!;
  pool.reportFailure(first, new Error("quota exceeded"));

  assert.equal(pool.next()?.value, "k2");
  assert.equal(pool.next()?.value, "k3");
  assert.equal(pool.next()?.value, "k2");
  assert.equal(pool.status().keys.find((item) => item.label === "key#1")?.state, "blocked");

  pool.resetFailures();
  assert.equal(pool.status().keys.find((item) => item.label === "key#1")?.state, "ready");
});

test("ApiKeyPool returns null when every key is blocked", () => {
  const pool = new ApiKeyPool(["k1"]);
  const first = pool.next()!;
  pool.reportFailure(first, new Error("insufficient balance"));

  assert.equal(pool.next(), null);
});
