import test from "node:test";
import assert from "node:assert/strict";
import { TranslationQueue } from "./translation-queue.js";
import type { RegisteredSurface } from "../surface/surface-registry.js";

function surface(index: number): RegisteredSurface {
  return {
    index,
    surfaceId: `s${index}`,
    element: {} as HTMLElement,
    imageUrl: `https://cdn.example/${index}.webp`,
    rect: { x: 0, y: index * 1000, width: 800, height: 1000 },
    naturalSize: { width: 800, height: 1000 },
  };
}

test("TranslationQueue starts from first chapter image and skips completed or cached", async () => {
  const processed: string[] = [];
  const queue = new TranslationQueue({ concurrency: 1, worker: async (item) => { processed.push(item.surfaceId); } });
  queue.setSurfaces([surface(1), surface(2), surface(3), surface(4)]);
  queue.mark("s1", "cached");
  queue.mark("s3", "completed");

  await queue.startAuto();

  assert.deepEqual(processed, ["s2", "s4"]);
  assert.equal(queue.snapshot().completed, 3);
  assert.equal(queue.snapshot().cached, 1);
});

test("TranslationQueue marks failures and continues later images", async () => {
  const processed: string[] = [];
  const queue = new TranslationQueue({
    concurrency: 1,
    worker: async (item) => {
      processed.push(item.surfaceId);
      if (item.surfaceId === "s2") throw new Error("OCR failed");
    },
  });
  queue.setSurfaces([surface(1), surface(2), surface(3)]);

  await queue.startAuto();

  assert.deepEqual(processed, ["s1", "s2", "s3"]);
  assert.equal(queue.getStatus("s2"), "failed");
  assert.equal(queue.getStatus("s3"), "completed");
  assert.equal(queue.snapshot().failed, 1);
});

test("TranslationQueue can pause, clear, and ignore queued work", async () => {
  const processed: string[] = [];
  const queue = new TranslationQueue({ concurrency: 1, worker: async (item) => { processed.push(item.surfaceId); } });
  queue.setSurfaces([surface(1), surface(2)]);

  queue.pause();
  await queue.startAuto();
  assert.deepEqual(processed, []);

  queue.clear("test");
  assert.equal(queue.snapshot().total, 0);
});

test("TranslationQueue notifies status changes for controls and progress", async () => {
  const changes: Array<[string, string]> = [];
  const queue = new TranslationQueue({
    concurrency: 1,
    onStatusChange: (surfaceId, status) => changes.push([surfaceId, status]),
    worker: async () => "cached",
  });
  queue.setSurfaces([surface(1)]);

  await queue.startAuto();

  assert.deepEqual(changes, [["s1", "idle"], ["s1", "queued"], ["s1", "translating"], ["s1", "cached"]]);
});

test("TranslationQueue counts cancelled surfaces as terminal progress", () => {
  const queue = new TranslationQueue({ concurrency: 1, worker: async () => "completed" });
  queue.setSurfaces([surface(1), surface(2), surface(3)]);

  queue.mark("s1", "completed");
  queue.mark("s2", "cancelled");
  queue.mark("s3", "failed");

  const snapshot = queue.snapshot();
  assert.equal(snapshot.completed, 1);
  assert.equal(snapshot.cancelled, 1);
  assert.equal(snapshot.failed, 1);
});

test("TranslationQueue removes a finished worker from processing before final status notification", async () => {
  const snapshots: Array<{ status: string; processing: number }> = [];
  let queue!: TranslationQueue;
  queue = new TranslationQueue({
    concurrency: 1,
    onStatusChange: (_surfaceId, status) => snapshots.push({ status, processing: queue.snapshot().processing }),
    worker: async () => "completed",
  });
  queue.setSurfaces([surface(1)]);

  await queue.startAuto();

  assert.deepEqual(snapshots.at(-1), { status: "completed", processing: 0 });
});

test("TranslationQueue snapshot counts active surface statuses as processing immediately", () => {
  const queue = new TranslationQueue({ concurrency: 1, worker: async () => "completed" });
  queue.setSurfaces([surface(1), surface(2), surface(3), surface(4)]);

  queue.mark("s1", "fetching");
  queue.mark("s2", "ocr");
  queue.mark("s3", "translating");
  queue.mark("s4", "queued");

  const snapshot = queue.snapshot();
  assert.equal(snapshot.processing, 3);
  assert.equal(snapshot.queued, 1);
});

test("TranslationQueue ignores stale non-terminal status after a terminal status", () => {
  const changes: string[] = [];
  const queue = new TranslationQueue({
    concurrency: 1,
    worker: async () => "completed",
    onStatusChange: (_surfaceId, status) => changes.push(status),
  });
  queue.setSurfaces([surface(1)]);

  queue.mark("s1", "completed");
  const accepted = queue.mark("s1", "translating");

  assert.equal(accepted, false);
  assert.equal(queue.getStatus("s1"), "completed");
  assert.deepEqual(changes, ["idle", "completed"]);
  assert.equal(queue.snapshot().completed, 1);
  assert.equal(queue.snapshot().processing, 0);
});

test("TranslationQueue clear prevents stale in-flight workers from writing statuses", async () => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const queue = new TranslationQueue({
    concurrency: 1,
    worker: async () => {
      await released;
      return "completed";
    },
  });
  queue.setSurfaces([surface(1)]);

  const running = queue.startAuto();
  await new Promise((resolve) => setTimeout(resolve, 0));
  queue.clear("test-clear");
  release();
  await running;

  assert.equal(queue.snapshot().total, 0);
  assert.equal(queue.getStatus("s1"), "idle");
});


test("TranslationQueue auto mode waits for an earlier page before starting later pages", async () => {
  const started: string[] = [];
  let releaseFirst!: () => void;
  const firstDone = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const queue = new TranslationQueue({
    concurrency: 3,
    worker: async (item) => {
      started.push(item.surfaceId);
      if (item.surfaceId === "s1") await firstDone;
    },
  });
  queue.setSurfaces([surface(1), surface(2), surface(3)]);

  const running = queue.startAuto();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, ["s1"]);

  releaseFirst();
  await running;
  assert.deepEqual(started, ["s1", "s2", "s3"]);
});
test("TranslationQueue resumes configured concurrency after the first pending page finishes", async () => {
  const started: string[] = [];
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstDone = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondDone = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const queue = new TranslationQueue({
    concurrency: 3,
    worker: async (item) => {
      started.push(item.surfaceId);
      if (item.surfaceId === "s1") await firstDone;
      if (item.surfaceId === "s2") await secondDone;
    },
  });
  queue.setSurfaces([surface(1), surface(2), surface(3), surface(4)]);

  const running = queue.startAuto();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, ["s1"]);

  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, ["s1", "s2", "s3", "s4"]);
  assert.equal(queue.getStatus("s1"), "completed");
  assert.equal(queue.getStatus("s2"), "translating");
  assert.equal(queue.getStatus("s3"), "completed");
  assert.equal(queue.getStatus("s4"), "completed");

  releaseSecond();
  await running;
  assert.equal(queue.getStatus("s2"), "completed");
});
