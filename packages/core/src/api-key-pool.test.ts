import test from "node:test";
import assert from "node:assert/strict";
import { ApiKeyPool } from "./api-key-pool.js";
import type { ApiKeyLease } from "./api-key-pool.js";

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

test("ApiKeyPool parks a rate-limited key in a cooldown and brings it back", () => {
  let now = 1_000;
  const pool = new ApiKeyPool(["k1", "k2"], { now: () => now, baseCooldownMs: 1000, maxCooldownMs: 8000 });
  const first = pool.next()!;
  pool.reportFailure(first, new Error("429 too many requests"), "cooldown");

  assert.equal(pool.next()?.value, "k2");
  assert.equal(pool.next()?.value, "k2");
  const parked = pool.status().keys.find((item) => item.label === "key#1")!;
  assert.equal(parked.state, "cooldown");
  assert.equal(parked.retryAfterMs, 1000);
  assert.equal(pool.status().available, 1);

  now += 1000;
  assert.equal(pool.next()?.value, "k1");
  assert.equal(pool.status().keys.find((item) => item.label === "key#1")?.state, "ready");
});

test("ApiKeyPool doubles each cooldown up to the cap", () => {
  let now = 0;
  const pool = new ApiKeyPool(["k1"], { now: () => now, baseCooldownMs: 1000, maxCooldownMs: 4000 });
  const waitAfterFailure = (): number => {
    pool.reportFailure(pool.next()!, new Error("429 rate limit reached"), "cooldown");
    return pool.status().keys.find((item) => item.label === "key#1")!.retryAfterMs!;
  };

  assert.equal(waitAfterFailure(), 1000);
  now += 1000;
  assert.equal(waitAfterFailure(), 2000);
  now += 2000;
  assert.equal(waitAfterFailure(), 4000);
  now += 4000;
  assert.equal(waitAfterFailure(), 4000);
});

test("ApiKeyPool keeps a successful key out of the cooldown ladder", () => {
  let now = 0;
  const pool = new ApiKeyPool(["k1"], { now: () => now, baseCooldownMs: 1000, maxCooldownMs: 8000 });
  const first = pool.next()!;
  pool.reportFailure(first, new Error("429 rate limit reached"), "cooldown");
  now += 1000;

  pool.reportSuccess(pool.next()!);

  const healthy = pool.status().keys.find((item) => item.label === "key#1")!;
  assert.equal(healthy.failures, 0);
  assert.equal(healthy.retryAfterMs, undefined);
  assert.equal(healthy.lastError, undefined);
});

test("ApiKeyPool keeps spent or rejected keys out until a new pool is built", () => {
  let now = 0;
  const pool = new ApiKeyPool(["k1", "k2"], { now: () => now, baseCooldownMs: 1000 });
  const first = pool.next()!;
  pool.reportFailure(first, new Error("402 insufficient balance"), "disabled");

  assert.equal(pool.next()?.value, "k2");
  assert.equal(pool.status().keys.find((item) => item.label === "key#1")?.state, "disabled");
  assert.equal(pool.status().available, 1);

  now += 60 * 60_000;
  assert.equal(pool.next()?.value, "k2");
  assert.equal(pool.status().keys.find((item) => item.label === "key#1")?.state, "disabled");
});

test("ApiKeyPool returns null when no key can be used", () => {
  const pool = new ApiKeyPool(["k1"], { now: () => 5_000, baseCooldownMs: 1000 });
  const first: ApiKeyLease = pool.next()!;
  pool.reportFailure(first, new Error("quota exceeded"), "cooldown");

  assert.equal(pool.next(), null);
  assert.equal(new ApiKeyPool([]).next(), null);
});
