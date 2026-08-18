import test from "node:test";
import assert from "node:assert/strict";
import type { SurfaceTask } from "@umt/shared";
import { assertAllowedImageUrl, readTaskImage } from "./image-input.js";

const baseTask: SurfaceTask = {
  surfaceId: "s1",
  pageUrl: "https://example.test/page",
  domain: "example.test",
  viewportPriority: "p0",
  surfaceRect: { x: 0, y: 0, width: 1, height: 1 },
  naturalSize: { width: 1, height: 1 },
  renderSize: { width: 1, height: 1 },
  readingDirection: "auto",
  sourceLanguage: "auto",
  targetLanguage: "zh-CN",
};

test("readTaskImage decodes data urls", async () => {
  const result = await readTaskImage({ ...baseTask, imageData: "data:text/plain;base64,aGVsbG8=" });
  assert.equal(result.buffer.toString("utf8"), "hello");
  assert.equal(result.source, "imageData");
});

test("readTaskImage fetches image urls", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from("from-url"), { status: 200 });
  try {
    const result = await readTaskImage({ ...baseTask, imageUrl: "https://cdn.example.test/1.jpg" });
    assert.equal(result.buffer.toString("utf8"), "from-url");
    assert.equal(result.source, "imageUrl");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readTaskImage retries transient image url fetch failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) throw new Error("socket closed");
    return new Response(Buffer.from("retried-url"), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await readTaskImage({ ...baseTask, imageUrl: "https://cdn.example.test/1.jpg" }, { retryDelayMs: 1 });
    assert.equal(result.buffer.toString("utf8"), "retried-url");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("assertAllowedImageUrl rejects SSRF-prone URLs", () => {
  assert.throws(() => assertAllowedImageUrl("file:///etc/passwd"), /must use http or https/);
  assert.throws(() => assertAllowedImageUrl("ftp://cdn.example.test/1.jpg"), /must use http or https/);
  assert.throws(() => assertAllowedImageUrl("https://user:pass@cdn.example.test/1.jpg"), /must not contain credentials/);
  assert.throws(() => assertAllowedImageUrl("http://169.254.169.254/latest/meta-data/"), /host is not allowed/);
  assert.throws(() => assertAllowedImageUrl("http://127.0.0.1:9000/image.png"), /host is not allowed/);
  assert.throws(() => assertAllowedImageUrl("http://localhost/image.png"), /host is not allowed/);
  assert.throws(() => assertAllowedImageUrl("http://10.0.0.5/image.png"), /host is not allowed/);
  assert.throws(() => assertAllowedImageUrl("http://192.168.1.10/image.png"), /host is not allowed/);
  assert.throws(() => assertAllowedImageUrl("http://172.20.0.1/image.png"), /host is not allowed/);
  assert.throws(() => assertAllowedImageUrl("http://100.64.0.1/image.png"), /host is not allowed/);
  assert.throws(() => assertAllowedImageUrl("http://0.0.0.0/image.png"), /host is not allowed/);
});

test("assertAllowedImageUrl allows public CDN urls", () => {
  assert.doesNotThrow(() => assertAllowedImageUrl("https://cdn.example.test/chapter/1.webp"));
  assert.doesNotThrow(() => assertAllowedImageUrl("http://example.test/image.png"));
});
