import type { QueueSnapshot } from "./translation-queue.js";

/**
 * The progress widget lives in the top frame but a page's surfaces can be split across frames,
 * so each frame's queue is summed into one tab-level view.
 */
export function mergeQueueSnapshots(snapshots: QueueSnapshot[]): QueueSnapshot {
  const merged: QueueSnapshot = { total: 0, detected: 0, queued: 0, processing: 0, completed: 0, cached: 0, empty: 0, failed: 0, cancelled: 0, paused: false };
  for (const snapshot of snapshots) {
    merged.total += snapshot.total;
    merged.detected += snapshot.detected;
    merged.queued += snapshot.queued;
    merged.processing += snapshot.processing;
    merged.completed += snapshot.completed;
    merged.cached += snapshot.cached;
    merged.empty += snapshot.empty;
    merged.failed += snapshot.failed;
    merged.cancelled += snapshot.cancelled;
  }
  const active = snapshots.filter((snapshot) => snapshot.total > 0);
  merged.paused = active.length > 0 && active.every((snapshot) => snapshot.paused);
  return merged;
}
