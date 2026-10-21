import {
  isUmtDelegateSelfTestRequest,
  isUmtEnsureFramesRequest,
  isUmtFrameContextRequest,
  isUmtFrameGoneReport,
  isUmtFrameProgressRequest,
  isUmtFrameRelayRequest,
  isUmtFrameStatsReport,
  type UmtContentCommand,
  type UmtDelegateSelfTestResponse,
  type UmtFrameProgressResponse,
  type UmtFrameContextResponse,
  type UmtFrameProgressMessage,
  type UmtFrameRelayResponse,
  type UmtPageSampleSelfTestResponse,
} from "../content/messages.js";
import { mergeQueueSnapshots } from "../content/queue/queue-snapshot.js";
import type { QueueSnapshot } from "../content/queue/translation-queue.js";
import {
  defaultSettingsStores,
  isSiteEnabled,
  loadSettings,
  singleAreaStores,
  type SettingsStorageArea,
  type SettingsStores,
} from "../settings/settings.js";

/** tabId -> frameId -> last report. Only frames that host pages show up here. */
export type FrameStatsState = Map<number, Map<number, QueueSnapshot>>;

export interface FrameMessageSender {
  tab?: { id?: number; url?: string };
  frameId?: number;
}

export interface FrameOrchestrationDeps {
  /** Test seam: a single area backing both preferences and secrets. */
  storage?: SettingsStorageArea;
  /** Reaches every frame of the tab, including the one that asked for the relay. */
  broadcastToTab: (tabId: number, message: UmtContentCommand) => Promise<unknown>;
  sendToFrame: (tabId: number, frameId: number, message: unknown) => Promise<unknown>;
  getTabUrl: (tabId: number) => Promise<string | undefined>;
  injectAllFrames: (tabId: number) => Promise<void>;
}

export function createFrameStatsState(): FrameStatsState {
  return new Map();
}

export function isFrameOrchestrationMessage(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (
    isUmtFrameContextRequest(value)
    || isUmtFrameStatsReport(value)
    || isUmtFrameGoneReport(value)
    || isUmtFrameProgressRequest(value)
    || isUmtDelegateSelfTestRequest(value)
    || isUmtFrameRelayRequest(value)
    || isUmtEnsureFramesRequest(value)
  );
}

export function mergedChildSnapshot(state: FrameStatsState, tabId: number): QueueSnapshot {
  const frames = state.get(tabId);
  const snapshots: QueueSnapshot[] = [];
  if (frames) {
    for (const [frameId, snapshot] of frames) {
      if (frameId === 0) continue;
      snapshots.push(snapshot);
    }
  }
  return mergeQueueSnapshots(snapshots);
}

/**
 * Frames keep their own translation queue, so the worker owns what a tab needs as a whole: it
 * tells a frame which page it belongs to and whether the reader is enabled there, merges child
 * frames into the progress widget that lives in the top frame, hands the popup's sample test to
 * the frame that actually holds pages, and injects frames a site added after load.
 */
export async function handleFrameMessage(
  message: unknown,
  sender: FrameMessageSender,
  deps: FrameOrchestrationDeps,
  state: FrameStatsState = createFrameStatsState(),
): Promise<unknown> {
  const tabId = sender.tab?.id;
  const frameId = typeof sender.frameId === "number" ? sender.frameId : 0;

  if (isUmtFrameContextRequest(message)) {
    if (typeof tabId !== "number") {
      const response: UmtFrameContextResponse = { ok: false, enabled: false, pageUrl: "" };
      return response;
    }
    const settings = await loadSettings(resolveStores(deps));
    const pageUrl = await tabUrlOf(sender, tabId, deps);
    const response: UmtFrameContextResponse = { ok: true, enabled: !!pageUrl && isSiteEnabled(settings, pageUrl), pageUrl };
    return response;
  }

  if (isUmtFrameStatsReport(message)) {
    if (typeof tabId !== "number") return { ok: false };
    const frames = state.get(tabId) ?? new Map<number, QueueSnapshot>();
    frames.set(frameId, message.snapshot);
    state.set(tabId, frames);
    await progressRelay(tabId, deps, state);
    return { ok: true };
  }

  if (isUmtFrameGoneReport(message)) {
    if (typeof tabId !== "number") return { ok: false };
    forgetFrame(state, tabId, frameId);
    await progressRelay(tabId, deps, state);
    return { ok: true };
  }

  if (isUmtFrameProgressRequest(message)) {
    const response: UmtFrameProgressResponse = {
      snapshot: typeof tabId === "number" ? mergedChildSnapshot(state, tabId) : mergeQueueSnapshots([]),
    };
    return response;
  }

  if (isUmtDelegateSelfTestRequest(message)) {
    const target = typeof tabId === "number" ? pickSelfTestFrame(state, tabId) : null;
    if (target === null || typeof tabId !== "number") {
      const response: UmtDelegateSelfTestResponse = { ok: false, status: "no-frame", detail: "这个标签页里没有报告到漫画页面的框架" };
      return response;
    }
    try {
      const response = await deps.sendToFrame(tabId, target, {
        source: "umt-service-worker",
        command: "sampleOcrSelfTest",
        frameScoped: true,
      }) as UmtPageSampleSelfTestResponse | undefined;
      if (!response) throw new Error("frame did not answer");
      return response;
    } catch {
      forgetFrame(state, tabId, target);
      const response: UmtDelegateSelfTestResponse = { ok: false, status: "no-frame", detail: `第 ${target} 号框架没有应答` };
      return response;
    }
  }

  if (isUmtFrameRelayRequest(message)) {
    if (typeof tabId !== "number") {
      const response: UmtFrameRelayResponse = { ok: false };
      return response;
    }
    const command: UmtContentCommand = {
      source: "umt-service-worker",
      command: message.pageCommand,
      // The top frame already ran the action before asking for the relay; without this marker it
      // would run it again on the broadcast and relay again, forever.
      frameScoped: true,
      ...(typeof message.visible === "boolean" ? { visible: message.visible } : {}),
    };
    // A frame that navigated away mid-click simply misses the command; the widget state is local.
    await deps.broadcastToTab(tabId, command).catch(() => undefined);
    const response: UmtFrameRelayResponse = { ok: true };
    return response;
  }

  if (isUmtEnsureFramesRequest(message)) {
    if (typeof tabId !== "number") return { ok: false };
    const settings = await loadSettings(resolveStores(deps));
    const pageUrl = await tabUrlOf(sender, tabId, deps);
    if (pageUrl && isSiteEnabled(settings, pageUrl)) await deps.injectAllFrames(tabId).catch(() => undefined);
    return { ok: true };
  }

  return undefined;
}

function forgetFrame(state: FrameStatsState, tabId: number, frameId: number): void {
  const frames = state.get(tabId);
  if (!frames) return;
  frames.delete(frameId);
  if (!frames.size) state.delete(tabId);
}

function pickSelfTestFrame(state: FrameStatsState, tabId: number): number | null {
  const frames = state.get(tabId);
  if (!frames) return null;
  let best: number | null = null;
  let bestSurfaces = 0;
  for (const [frameId, snapshot] of [...frames].sort((a, b) => a[0] - b[0])) {
    if (frameId === 0 || snapshot.total <= bestSurfaces) continue;
    best = frameId;
    bestSurfaces = snapshot.total;
  }
  return best;
}

async function progressRelay(tabId: number, deps: FrameOrchestrationDeps, state: FrameStatsState): Promise<void> {
  const message: UmtFrameProgressMessage = { source: "umt-service-worker", command: "frameProgress", snapshot: mergedChildSnapshot(state, tabId) };
  await deps.sendToFrame(tabId, 0, message).catch(() => undefined);
}

function resolveStores(deps: FrameOrchestrationDeps): SettingsStores {
  return deps.storage ? singleAreaStores(deps.storage) : defaultSettingsStores();
}

async function tabUrlOf(sender: FrameMessageSender, tabId: number, deps: FrameOrchestrationDeps): Promise<string> {
  const fromSender = sender.tab?.url;
  if (typeof fromSender === "string" && fromSender) return fromSender;
  return (await deps.getTabUrl(tabId).catch(() => undefined)) ?? "";
}

export function registerFrameOrchestrationHandlers(
  deps: FrameOrchestrationDeps,
  state: FrameStatsState = createFrameStatsState(),
  runtime: typeof chrome.runtime = chrome.runtime,
  tabs: typeof chrome.tabs = chrome.tabs,
): void {
  runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isFrameOrchestrationMessage(message)) return false;
    void handleFrameMessage(message, sender as FrameMessageSender, deps, state)
      .then((response) => sendResponse(response))
      .catch(() => sendResponse({ ok: false }));
    return true;
  });
  tabs.onRemoved?.addListener?.((tabId: number) => { state.delete(tabId); });
}
