import test from "node:test";
import assert from "node:assert/strict";
import {
  delegateSelfTest,
  ensureFramesInjected,
  isTopFrameWindow,
  notifyFrameGone,
  relayToFrames,
  reportFrameStats,
  requestFrameContext,
  requestFrameProgress,
  shouldScanChildFrame,
} from "./frame-context.js";
import type { QueueSnapshot } from "../queue/translation-queue.js";

const emptySnapshot: QueueSnapshot = { total: 0, detected: 0, queued: 0, processing: 0, completed: 0, cached: 0, empty: 0, failed: 0, cancelled: 0, paused: false };

function recordingRuntime(response: unknown = { ok: true }): { messages: unknown[]; sendMessage: (message: unknown) => Promise<unknown> } {
  const messages: unknown[] = [];
  return {
    messages,
    sendMessage: async (message: unknown) => { messages.push(message); return response; },
  };
}

test("shouldScanChildFrame keeps tiny ad frames dormant but never blocks the top frame", () => {
  assert.equal(shouldScanChildFrame(true, 0, 0), true);
  assert.equal(shouldScanChildFrame(false, 1200, 900), true);
  assert.equal(shouldScanChildFrame(false, 300, 900), false);
  assert.equal(shouldScanChildFrame(false, 900, 300), false);
});

test("isTopFrameWindow compares the frame against the tab window", () => {
  const window: { top: unknown; self: unknown; innerWidth: number; innerHeight: number } = { top: null, self: null, innerWidth: 1, innerHeight: 1 };
  window.top = window.self = window;

  assert.equal(isTopFrameWindow(window), true);
  assert.equal(isTopFrameWindow({ top: window, self: {}, innerWidth: 1, innerHeight: 1 }), false);
});

test("isTopFrameWindow treats a frame the embedder refuses to describe as a child frame", () => {
  const blocked = { get top(): unknown { throw new Error("cross-origin"); }, self: {}, innerWidth: 1, innerHeight: 1 };

  assert.equal(isTopFrameWindow(blocked), false);
});

test("requestFrameContext takes the page url the worker reports for the tab", async () => {
  const runtime = recordingRuntime({ ok: true, enabled: true, pageUrl: "https://manga.example/title/chapter/9" });

  assert.deepEqual(await requestFrameContext(runtime), { pageUrl: "https://manga.example/title/chapter/9" });
  assert.deepEqual(runtime.messages, [{ source: "umt-content", command: "frameContext" }]);
});

test("requestFrameContext stays dormant when the worker says the site is not enabled", async () => {
  assert.equal(await requestFrameContext(recordingRuntime({ ok: true, enabled: false, pageUrl: "https://other.example/" })), null);
  assert.equal(await requestFrameContext(recordingRuntime({ ok: true, enabled: true, pageUrl: "" })), null);
  assert.equal(await requestFrameContext({ sendMessage: async () => { throw new Error("context invalidated"); } }), null);
});

test("reportFrameStats and notifyFrameGone are best-effort and never reject", async () => {
  const runtime = recordingRuntime({ ok: true });
  reportFrameStats({ ...emptySnapshot, total: 3, completed: 2 }, runtime);
  notifyFrameGone(runtime);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(runtime.messages, [
    { source: "umt-content", command: "frameStats", snapshot: { ...emptySnapshot, total: 3, completed: 2 } },
    { source: "umt-content", command: "frameGone" },
  ]);
});

test("relayToFrames asks the worker to run the button action in the reader frames", async () => {
  const runtime = recordingRuntime({ ok: true });
  relayToFrames("setOverlayVisibility", false, runtime);
  relayToFrames("retranslateVisible", undefined, runtime);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(runtime.messages, [
    { source: "umt-content", command: "relayToFrames", pageCommand: "setOverlayVisibility", visible: false },
    { source: "umt-content", command: "relayToFrames", pageCommand: "retranslateVisible" },
  ]);
});

test("delegateSelfTest returns the sample result chosen by the worker", async () => {
  const result = { ok: true as const, status: "ok" as const, surfaceIndex: 2, regionCount: 7, elapsedMs: 120 };

  assert.deepEqual(await delegateSelfTest(recordingRuntime(result)), result);
});

test("delegateSelfTest gives up when no frame reported pages", async () => {
  assert.equal(await delegateSelfTest(recordingRuntime({ ok: false, status: "no-frame", detail: "没有框架" })), null);
  assert.equal(await delegateSelfTest({ sendMessage: async () => { throw new Error("worker asleep"); } }), null);
});

test("ensureFramesInjected asks the worker to reach frames the site added after load", async () => {
  const runtime = recordingRuntime({ ok: true });
  ensureFramesInjected(runtime);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(runtime.messages, [{ source: "umt-content", command: "ensureFrames" }]);
});

test("requestFrameProgress pulls the merged child queues once for the top frame", async () => {
  const runtime = recordingRuntime({ snapshot: { ...emptySnapshot, total: 2 } });

  assert.deepEqual(await requestFrameProgress(runtime), { ...emptySnapshot, total: 2 });
  assert.deepEqual(runtime.messages, [{ source: "umt-content", command: "frameProgressRequest" }]);
});

test("requestFrameProgress gives up when the worker is unreachable or answers with nothing", async () => {
  assert.equal(await requestFrameProgress(recordingRuntime({})), null);
  assert.equal(await requestFrameProgress({ sendMessage: async () => { throw new Error("worker asleep"); } }), null);
});
