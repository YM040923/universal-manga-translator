import type { QueueSnapshot } from "../queue/translation-queue.js";
import type { UmtContentCommandName, UmtDelegateSelfTestResponse, UmtFrameProgressResponse, UmtPageSampleSelfTestResponse } from "../messages.js";

/** Embedded readers fill the window; ad and tracker frames rarely reach this size. */
export const MIN_CHILD_FRAME_SIDE = 320;

export interface FrameContext {
  /** The tab's top-level URL: site settings, caches and revoking all belong to the page the reader sees. */
  pageUrl: string;
}

interface FrameMessageRuntime {
  sendMessage: (message: unknown) => Promise<unknown>;
}

type FrameWindow = { innerWidth: number; innerHeight: number; top: unknown; self: unknown };

export function isTopFrameWindow(target: FrameWindow): boolean {
  try {
    return target.top === target.self;
  } catch {
    // A frame whose embedder denies the comparison is not the top frame.
    return false;
  }
}

/**
 * A child frame only runs when it is big enough to plausibly be a reader. The top frame keeps the
 * previous behaviour of mounting whenever its own site is enabled.
 */
export function shouldScanChildFrame(isTopFrame: boolean, width: number, height: number): boolean {
  if (isTopFrame) return true;
  return width >= MIN_CHILD_FRAME_SIDE && height >= MIN_CHILD_FRAME_SIDE;
}

/**
 * Ask the service worker which page this frame belongs to. Only the worker can see the tab's
 * top-level URL and the enabled-site list, so an embedded cross-origin reader frame cannot decide
 * for itself that it is allowed to run — a null answer means "this frame must stay dormant".
 */
export async function requestFrameContext(runtime: FrameMessageRuntime = chrome.runtime): Promise<FrameContext | null> {
  try {
    const response = await runtime.sendMessage({ source: "umt-content", command: "frameContext" }) as Partial<{ ok: boolean; enabled: boolean; pageUrl: string }> | undefined;
    if (!response?.ok || !response.enabled || typeof response.pageUrl !== "string" || !response.pageUrl) return null;
    return { pageUrl: response.pageUrl };
  } catch {
    return null;
  }
}

/** Lets the top frame show one progress widget for queues that live in several frames. */
export function reportFrameStats(snapshot: QueueSnapshot, runtime: FrameMessageRuntime = chrome.runtime): void {
  void runtime.sendMessage({ source: "umt-content", command: "frameStats", snapshot }).catch(() => {
    // The worker can be asleep or the frame can be mid-teardown; stats are best-effort.
  });
}

/**
 * One-shot pull for the top frame: a child can report its first scan before the top frame's
 * listener exists, so the pushed merge would otherwise be lost until the next status change.
 */
export async function requestFrameProgress(runtime: FrameMessageRuntime = chrome.runtime): Promise<QueueSnapshot | null> {
  try {
    const response = await runtime.sendMessage({ source: "umt-content", command: "frameProgressRequest" }) as Partial<UmtFrameProgressResponse> | undefined;
    const snapshot = response?.snapshot;
    return snapshot && typeof snapshot.total === "number" ? snapshot : null;
  } catch {
    return null;
  }
}

export function relayToFrames(pageCommand: UmtContentCommandName, visible?: boolean, runtime: FrameMessageRuntime = chrome.runtime): void {
  void runtime.sendMessage({ source: "umt-content", command: "relayToFrames", pageCommand, ...(visible === undefined ? {} : { visible }) }).catch(() => {});
}

export async function delegateSelfTest(runtime: FrameMessageRuntime = chrome.runtime): Promise<UmtPageSampleSelfTestResponse | null> {
  try {
    const response = await runtime.sendMessage({ source: "umt-content", command: "delegateSelfTest" }) as UmtDelegateSelfTestResponse | undefined;
    if (!response) return null;
    if (response.status === "no-frame") return null;
    return response;
  } catch {
    return null;
  }
}

/** A reader iframe the site adds after load has no content script until the worker injects one. */
export function ensureFramesInjected(runtime: FrameMessageRuntime = chrome.runtime): void {
  void runtime.sendMessage({ source: "umt-content", command: "ensureFrames" }).catch(() => {});
}

export function notifyFrameGone(runtime: FrameMessageRuntime = chrome.runtime): void {
  void runtime.sendMessage({ source: "umt-content", command: "frameGone" }).catch(() => {});
}
