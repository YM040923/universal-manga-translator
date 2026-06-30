import test from "node:test";
import assert from "node:assert/strict";
import { TranslationStatusCounter } from "./job-status-counter.js";

test("TranslationStatusCounter counts completed and failed jobs once per surface", () => {
  const counter = new TranslationStatusCounter();
  counter.recordEvent({ type: "job.queued", surfaceId: "s1" });
  counter.recordEvent({ type: "job.processing", surfaceId: "s1" });
  counter.recordEvent({ type: "job.completed", surfaceId: "s1", result: fakeResult("s1") });
  counter.recordEvent({ type: "job.failed", surfaceId: "s2", result: { surfaceId: "s2", status: "failed", recoverable: true, error: "provider failed" } });
  counter.recordFailedResponse("s2");

  assert.deepEqual(counter.snapshot(), { queued: 1, processing: 0, done: 1, failed: 1 });
  assert.equal(counter.format(), "UMT: queued 1 | processing 0 | done 1 | failed 1");
});

function fakeResult(surfaceId: string) {
  return {
    surfaceId,
    imageHash: "hash",
    status: "completed" as const,
    regions: [],
    providerProfile: "test",
    layoutVersion: 1,
    elapsedMs: 1,
  };
}