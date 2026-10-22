import test from "node:test";
import assert from "node:assert/strict";
import { mergeQueueSnapshots } from "./queue-snapshot.js";
import type { QueueSnapshot } from "./translation-queue.js";

function snapshot(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return { total: 0, detected: 0, queued: 0, processing: 0, completed: 0, cached: 0, empty: 0, failed: 0, cancelled: 0, paused: false, ...overrides };
}

test("mergeQueueSnapshots adds up the counters of every frame", () => {
  const merged = mergeQueueSnapshots([
    snapshot({ total: 4, completed: 2, cached: 1, failed: 1 }),
    snapshot({ total: 6, queued: 3, processing: 2, empty: 1 }),
  ]);

  assert.deepEqual(merged, snapshot({ total: 10, queued: 3, processing: 2, completed: 2, cached: 1, empty: 1, failed: 1 }));
});

test("mergeQueueSnapshots treats an empty tab as not paused", () => {
  assert.equal(mergeQueueSnapshots([]).paused, false);
  assert.equal(mergeQueueSnapshots([snapshot()]).paused, false);
});

test("mergeQueueSnapshots only reports paused once every frame that holds pages is paused", () => {
  assert.equal(mergeQueueSnapshots([snapshot({ total: 2, paused: true }), snapshot({ total: 3 })]).paused, false);
  assert.equal(mergeQueueSnapshots([snapshot({ total: 2, paused: true }), snapshot({ total: 3, paused: true })]).paused, true);
});

test("mergeQueueSnapshots keeps a cancelled frame out of the running total", () => {
  const merged = mergeQueueSnapshots([snapshot({ total: 5, cancelled: 5 }), snapshot({ total: 2, processing: 1, queued: 1 })]);

  assert.equal(merged.cancelled, 5);
  assert.equal(merged.processing, 1);
  assert.equal(merged.total, 7);
});
