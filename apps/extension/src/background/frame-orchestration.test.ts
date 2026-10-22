import test from "node:test";
import assert from "node:assert/strict";
import {
  createFrameStatsState,
  handleFrameMessage,
  isFrameOrchestrationMessage,
  mergedChildSnapshot,
  type FrameMessageSender,
  type FrameOrchestrationDeps,
} from "./frame-orchestration.js";
import { DEFAULT_SETTINGS, type SettingsStorageArea } from "../settings/settings.js";
import type { QueueSnapshot } from "../content/queue/translation-queue.js";
import type { UmtDelegateSelfTestResponse, UmtFrameContextResponse, UmtFrameProgressResponse } from "../content/messages.js";

const CHAPTER_URL = "https://asurascans.com/secret/chapter/12";

function snapshot(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return { total: 0, detected: 0, queued: 0, processing: 0, completed: 0, cached: 0, empty: 0, failed: 0, cancelled: 0, paused: false, ...overrides };
}

function topFrame(tabId = 1): FrameMessageSender {
  return { tab: { id: tabId, url: CHAPTER_URL }, frameId: 0 };
}

function childFrame(frameId: number, tabId = 1, url = CHAPTER_URL): FrameMessageSender {
  return { tab: { id: tabId, url }, frameId };
}

interface FakeDeps {
  deps: FrameOrchestrationDeps;
  frameMessages: Array<{ tabId: number; frameId: number; message: Record<string, unknown> }>;
  broadcasts: Array<{ tabId: number; message: Record<string, unknown> }>;
  injections: number[];
}

function fakeDeps(sampleResult?: Record<string, unknown>): FakeDeps {
  const frameMessages: FakeDeps["frameMessages"] = [];
  const broadcasts: FakeDeps["broadcasts"] = [];
  const injections: number[] = [];
  const deps: FrameOrchestrationDeps = {
    storage: fakeStorage(),
    broadcastToTab: async (tabId, message) => { broadcasts.push({ tabId, message: message as unknown as Record<string, unknown> }); },
    sendToFrame: async (tabId, frameId, message) => {
      const record = message as unknown as Record<string, unknown>;
      frameMessages.push({ tabId, frameId, message: record });
      if (record.command === "sampleOcrSelfTest") {
        if (!sampleResult) throw new Error("frame is gone");
        return sampleResult;
      }
      return undefined;
    },
    getTabUrl: async () => undefined,
    injectAllFrames: async (tabId) => { injections.push(tabId); },
  };
  return { deps, frameMessages, broadcasts, injections };
}

function fakeStorage(initial: Record<string, unknown> = {}): SettingsStorageArea & { current: typeof DEFAULT_SETTINGS } {
  return {
    current: { ...structuredClone(DEFAULT_SETTINGS), ...initial },
    async get() { return this.current as unknown as Record<string, unknown>; },
    async set(value) { this.current = { ...this.current, ...value }; },
  };
}

test("frame context handshake answers with the tab url the worker owns", async () => {
  const storage = fakeStorage({ enabledSites: { "asurascans.com": true } });
  const { deps } = fakeDeps();

  const response = await handleFrameMessage({ source: "umt-content", command: "frameContext" }, childFrame(4), { ...deps, storage }) as UmtFrameContextResponse;

  assert.deepEqual(response, { ok: true, enabled: true, pageUrl: CHAPTER_URL });
});

test("frame context handshake refuses a frame whose tab site was never enabled", async () => {
  const { deps } = fakeDeps();

  const response = await handleFrameMessage({ source: "umt-content", command: "frameContext" }, childFrame(4, 1, "https://other.example/chapter/1"), deps) as UmtFrameContextResponse;

  assert.equal(response.enabled, false);
});

test("frame context handshake cannot be told another page url", async () => {
  const { deps } = fakeDeps();

  const response = await handleFrameMessage(
    { source: "umt-content", command: "frameContext", pageUrl: "https://evil.example/" },
    { tab: { id: 9 }, frameId: 2 },
    deps,
  ) as UmtFrameContextResponse;

  assert.deepEqual(response, { ok: true, enabled: false, pageUrl: "" });
});

test("frame stats are merged and pushed to the top frame that owns the progress widget", async () => {
  const { deps, frameMessages } = fakeDeps();
  const state = createFrameStatsState();

  await handleFrameMessage({ source: "umt-content", command: "frameStats", snapshot: snapshot({ total: 3, completed: 2 }) }, childFrame(2), deps, state);
  await handleFrameMessage({ source: "umt-content", command: "frameStats", snapshot: snapshot({ total: 4, queued: 1, paused: true }) }, childFrame(3), deps, state);

  assert.deepEqual(frameMessages.map((entry) => entry.frameId), [0, 0]);
  assert.deepEqual(frameMessages[1]!.message["snapshot"], snapshot({ total: 7, completed: 2, queued: 1 }));
  assert.equal(frameMessages[1]!.message["source"], "umt-service-worker");
});

test("the top frame never receives its own report back", async () => {
  const { deps, frameMessages } = fakeDeps();
  const state = createFrameStatsState();

  await handleFrameMessage({ source: "umt-content", command: "frameStats", snapshot: snapshot({ total: 5 }) }, topFrame(), deps, state);

  assert.equal(mergedChildSnapshot(state, 1).total, 0);
  assert.deepEqual(frameMessages[0]!.message["snapshot"], snapshot());
});

test("the top frame can pull the merged child view after it starts listening", async () => {
  const { deps } = fakeDeps();
  const state = createFrameStatsState();
  await handleFrameMessage({ source: "umt-content", command: "frameStats", snapshot: snapshot({ total: 2, completed: 1 }) }, childFrame(2), deps, state);
  await handleFrameMessage({ source: "umt-content", command: "frameStats", snapshot: snapshot({ total: 5 }) }, topFrame(), deps, state);
  await handleFrameMessage({ source: "umt-content", command: "frameStats", snapshot: snapshot({ total: 4, queued: 1 }) }, childFrame(3), deps, state);

  const response = await handleFrameMessage({ source: "umt-content", command: "frameProgressRequest" }, topFrame(), deps, state) as UmtFrameProgressResponse;

  assert.deepEqual(response.snapshot, snapshot({ total: 6, completed: 1, queued: 1 }));
});

test("the listener claims the progress pull and leaves its own push to the content side", () => {
  assert.equal(isFrameOrchestrationMessage({ source: "umt-content", command: "frameProgressRequest" }), true);
  assert.equal(isFrameOrchestrationMessage({ source: "umt-service-worker", command: "frameProgress", snapshot: snapshot() }), false);
});

test("a frame that goes away drops out of the merged tab view", async () => {  const { deps, frameMessages } = fakeDeps();
  const state = createFrameStatsState();

  await handleFrameMessage({ source: "umt-content", command: "frameStats", snapshot: snapshot({ total: 2, completed: 1 }) }, childFrame(2), deps, state);
  await handleFrameMessage({ source: "umt-content", command: "frameGone" }, childFrame(2), deps, state);

  assert.equal(mergedChildSnapshot(state, 1).total, 0);
  assert.deepEqual(frameMessages.at(-1)!.message["snapshot"], snapshot());
});

test("the sample test is delegated to the frame that holds the most pages", async () => {
  const sampleResult = { ok: true, status: "ok", surfaceIndex: 1, regionCount: 6, elapsedMs: 90 };
  const { deps, frameMessages } = fakeDeps(sampleResult);
  const state = createFrameStatsState();
  await handleFrameMessage({ source: "umt-content", command: "frameStats", snapshot: snapshot({ total: 1 }) }, childFrame(2), deps, state);
  await handleFrameMessage({ source: "umt-content", command: "frameStats", snapshot: snapshot({ total: 6 }) }, childFrame(7), deps, state);
  await handleFrameMessage({ source: "umt-content", command: "frameStats", snapshot: snapshot({ total: 9 }) }, topFrame(), deps, state);

  const response = await handleFrameMessage({ source: "umt-content", command: "delegateSelfTest" }, topFrame(), deps, state) as typeof sampleResult;

  assert.equal(response.regionCount, 6);
  const scoped = frameMessages.find((entry) => entry.message["command"] === "sampleOcrSelfTest")!;
  assert.equal(scoped.frameId, 7);
  assert.equal(scoped.message["frameScoped"], true);
  assert.equal(scoped.message["source"], "umt-service-worker");
});

test("delegating falls back when no frame holds pages or the frame died", async () => {
  const state = createFrameStatsState();
  const { deps } = fakeDeps();
  const unreachable = fakeDeps();

  const nobody = await handleFrameMessage({ source: "umt-content", command: "delegateSelfTest" }, topFrame(), deps, state) as UmtDelegateSelfTestResponse;
  assert.equal(nobody.status, "no-frame");

  await handleFrameMessage({ source: "umt-content", command: "frameStats", snapshot: snapshot({ total: 4 }) }, childFrame(3), unreachable.deps, state);
  const gone = await handleFrameMessage({ source: "umt-content", command: "delegateSelfTest" }, topFrame(), unreachable.deps, state) as UmtDelegateSelfTestResponse;

  assert.equal(gone.status, "no-frame");
  assert.equal(mergedChildSnapshot(state, 1).total, 0);
});

test("the floating button relays its action to every frame of the tab", async () => {
  const { deps, broadcasts } = fakeDeps();

  await handleFrameMessage({ source: "umt-content", command: "relayToFrames", pageCommand: "setOverlayVisibility", visible: false }, topFrame(), deps);

  assert.deepEqual(broadcasts, [{
    tabId: 1,
    // The marker keeps the origin frame from running and relaying the broadcast a second time.
    message: { source: "umt-service-worker", command: "setOverlayVisibility", frameScoped: true, visible: false },
  }]);
});

test("the relay refuses commands the widget is not allowed to forward", async () => {
  const { deps, broadcasts } = fakeDeps();

  const response = await handleFrameMessage({ source: "umt-content", command: "relayToFrames", pageCommand: "clearPage" }, topFrame(), deps);

  assert.equal(response, undefined);
  assert.equal(broadcasts.length, 0);
});

test("late reader frames are injected again only on an enabled site", async () => {
  const storage = fakeStorage({ enabledSites: { "asurascans.com": true } });
  const { deps, injections } = fakeDeps();

  await handleFrameMessage({ source: "umt-content", command: "ensureFrames" }, topFrame(), { ...deps, storage });
  await handleFrameMessage({ source: "umt-content", command: "ensureFrames" }, childFrame(2, 5, "https://other.example/chapter/1"), { ...deps, storage });

  assert.deepEqual(injections, [1]);
});

test("messages that are not the worker's business are left to the other listeners", async () => {
  const { deps } = fakeDeps();

  assert.equal(await handleFrameMessage({ source: "umt-popup", command: "translate" }, topFrame(), deps), undefined);
  assert.equal(await handleFrameMessage({ source: "umt-content", command: "frameStats", snapshot: { total: 1 } }, topFrame(), deps), undefined);
});
