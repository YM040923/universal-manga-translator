import test from "node:test";
import assert from "node:assert/strict";
import type { SurfaceTask } from "@umt/shared";
import { readTaskImage } from "./image-input.js";

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
