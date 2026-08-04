import {
  isUmtActivateSiteRequest,
  isUmtDispatchContentCommandRequest,
  isUmtFrameAuthorizationRequest,
  type UmtActivateSiteRequest,
  type UmtActivateSiteResponse,
  type UmtContentCommand,
  type UmtContentCommandResponse,
  type UmtDispatchContentCommandRequest,
  type UmtFrameAuthorizationResponse,
  type UmtPageSampleSelfTestResponse,
} from "../content/messages.js";
import { enableSiteForUrl, isSiteEnabled, loadSettings, saveSettings, type SettingsStorageArea } from "../settings/settings.js";

export interface ContentScriptInjectionDeps {
  storage?: SettingsStorageArea;
  executeScript: (details: { tabId: number; files: string[]; allFrames?: boolean }) => Promise<void> | void;
}

export interface InjectableTab {
  id?: number;
  url?: string;
}

export interface TabQueryDeps extends ContentScriptInjectionDeps {
  queryTabs: () => Promise<InjectableTab[]> | InjectableTab[];
}

export interface FrameAuthorizationDeps {
  storage?: SettingsStorageArea;
  getTab: (tabId: number) => Promise<InjectableTab> | InjectableTab;
}

export interface FrameCommandDeps {
  getAllFrames: (details: { tabId: number }) => Promise<Array<{ frameId: number }>> | Array<{ frameId: number }>;
  sendMessage: (tabId: number, message: UmtContentCommand, options: { frameId: number }) => Promise<unknown> | unknown;
}

export interface EmbeddedFrameInjectionDeps extends ContentScriptInjectionDeps {
  getTab: (tabId: number) => Promise<InjectableTab> | InjectableTab;
}

export async function handleActivateSiteMessage(message: UmtActivateSiteRequest, deps: ContentScriptInjectionDeps): Promise<UmtActivateSiteResponse> {
  try {
    const storage = deps.storage;
    const settings = await loadSettings(storage);
    const next = enableSiteForUrl(settings, message.url);
    await saveSettings(next, storage);
    await injectContentScript(message.tabId, deps);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Allows an injected child frame only when its top-level tab was explicitly enabled. */
export async function authorizeEmbeddedFrame(sender: chrome.runtime.MessageSender, deps: FrameAuthorizationDeps): Promise<UmtFrameAuthorizationResponse> {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return { ok: false, error: "Unable to identify the embedded reader tab" };
  const tab = await deps.getTab(tabId);
  if (!tab.url) return { ok: false, error: "Unable to read the top-level tab URL" };
  const settings = await loadSettings(deps.storage);
  if (!isSiteEnabled(settings, tab.url)) return { ok: false, error: "The top-level site is not enabled" };
  return { ok: true, siteUrl: tab.url };
}

/** Delivers a popup action to the top document and every injected reader frame. */
export async function dispatchContentCommandToFrames(input: UmtDispatchContentCommandRequest, deps: FrameCommandDeps): Promise<UmtContentCommandResponse | UmtPageSampleSelfTestResponse> {
  const frames = await deps.getAllFrames({ tabId: input.tabId });
  const frameIds = [...new Set(frames.map((frame) => frame.frameId))].sort((left, right) => left - right);
  if (!frameIds.includes(0)) frameIds.unshift(0);
  const responses = await Promise.all(frameIds.map(async (frameId) => {
    try {
      return await deps.sendMessage(input.tabId, input.message, { frameId });
    } catch {
      return null;
    }
  }));
  if (input.message.command === "sampleOcrSelfTest") {
    const samples = responses.filter(isPageSampleSelfTestResponse);
    return [...samples].sort(comparePageSampleSelfTestResponse).at(0) ?? noPageSampleResponse();
  }
  const usable = responses.map(asContentCommandResponse).filter((response): response is UmtContentCommandResponse => response !== null);
  if (!usable.length) return noFrameResponse();
  return [...usable].sort(compareFrameResponse).at(0) ?? noFrameResponse();
}

export async function maybeInjectContentScriptForTab(tabId: number, url: string | undefined, deps: ContentScriptInjectionDeps): Promise<void> {
  if (!url) return;
  const settings = await loadSettings(deps.storage);
  if (!isSiteEnabled(settings, url)) return;
  await injectContentScript(tabId, deps);
}

/** Re-injects after a reader iframe is created or navigated after the top-level page. */
export async function maybeInjectContentScriptForEmbeddedFrame(tabId: number, frameId: number, deps: EmbeddedFrameInjectionDeps): Promise<void> {
  if (frameId === 0) return;
  const tab = await deps.getTab(tabId);
  await maybeInjectContentScriptForTab(tabId, tab.url, deps);
}

export async function injectContentScriptsIntoEnabledTabs(deps: TabQueryDeps): Promise<void> {
  const tabs = await deps.queryTabs();
  await Promise.all(tabs.map(async (tab) => {
    if (typeof tab.id !== "number") return;
    await maybeInjectContentScriptForTab(tab.id, tab.url, deps).catch(() => {
      // Some Chrome pages, PDF viewers, discarded tabs, or restricted frames reject
      // scripting injection. Ignore per-tab failures so one bad tab does not prevent
      // already enabled manga tabs from being restored after extension reload.
    });
  }));
}

export function registerSiteActivationHandlers(
  runtime: typeof chrome.runtime = chrome.runtime,
  tabs: typeof chrome.tabs = chrome.tabs,
  scripting: typeof chrome.scripting = chrome.scripting,
  webNavigation: typeof chrome.webNavigation = chrome.webNavigation,
): void {
  const deps: ContentScriptInjectionDeps = {
    executeScript: async (details) => { await scripting.executeScript({ target: { tabId: details.tabId, allFrames: details.allFrames }, files: details.files }); },
  };
  runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isUmtActivateSiteRequest(message)) {
      void handleActivateSiteMessage(message, deps).then(sendResponse);
      return true;
    }
    if (isUmtFrameAuthorizationRequest(message)) {
      void authorizeEmbeddedFrame(sender, { ...(deps.storage ? { storage: deps.storage } : {}), getTab: async (tabId) => { const tab = await tabs.get(tabId); return typeof tab.url === "string" ? { url: tab.url } : {}; } }).then(sendResponse);
      return true;
    }
    if (isUmtDispatchContentCommandRequest(message)) {
      void dispatchContentCommandToFrames(message, {
        getAllFrames: async ({ tabId }) => (await webNavigation.getAllFrames({ tabId })) ?? [],
        sendMessage: async (tabId, command, options) => await tabs.sendMessage(tabId, command, options),
      }).then(sendResponse);
      return true;
    }
    return false;
  });
  tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    void maybeInjectContentScriptForTab(tabId, tab.url, deps);
  });
  webNavigation.onCommitted.addListener((details) => {
    void maybeInjectContentScriptForEmbeddedFrame(details.tabId, details.frameId, {
      ...deps,
      getTab: async (tabId) => {
        const tab = await tabs.get(tabId);
        return typeof tab.url === "string" ? { url: tab.url } : {};
      },
    }).catch(() => {
      // A frame can disappear between navigation and injection. The next top-level
      // update or popup action will inject again if the reader is still present.
    });
  });
  const queryDeps: TabQueryDeps = {
    ...deps,
    queryTabs: async () => (await tabs.query({ url: ["http://*/*", "https://*/*"] })).map((tab) => ({
      ...(typeof tab.id === "number" ? { id: tab.id } : {}),
      ...(typeof tab.url === "string" ? { url: tab.url } : {}),
    })),
  };
  runtime.onStartup?.addListener?.(() => { void injectContentScriptsIntoEnabledTabs(queryDeps); });
  runtime.onInstalled?.addListener?.(() => { void injectContentScriptsIntoEnabledTabs(queryDeps); });
  void injectContentScriptsIntoEnabledTabs(queryDeps);
}

async function injectContentScript(tabId: number, deps: ContentScriptInjectionDeps): Promise<void> {
  await deps.executeScript({ tabId, files: ["content.js"], allFrames: true });
}

function asContentCommandResponse(value: unknown): UmtContentCommandResponse | null {
  if (!value || typeof value !== "object") return null;
  const response = value as Partial<UmtContentCommandResponse>;
  if (typeof response.ok !== "boolean" || !response.state) return null;
  return response as UmtContentCommandResponse;
}

function isPageSampleSelfTestResponse(value: unknown): value is UmtPageSampleSelfTestResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<UmtPageSampleSelfTestResponse>;
  if (response.ok === true) return response.status === "ok" && typeof response.surfaceIndex === "number" && typeof response.regionCount === "number";
  return response.ok === false && (response.status === "no-reader-page" || response.status === "no-surface" || response.status === "empty" || response.status === "failed") && typeof response.detail === "string";
}

function comparePageSampleSelfTestResponse(left: UmtPageSampleSelfTestResponse, right: UmtPageSampleSelfTestResponse): number {
  return pageSampleScore(right) - pageSampleScore(left);
}

function pageSampleScore(response: UmtPageSampleSelfTestResponse): number {
  if (response.ok) return 100;
  if (response.status === "failed") return 40;
  if (response.status === "empty") return 30;
  if (response.status === "no-surface") return 20;
  return 10;
}

function compareFrameResponse(left: UmtContentCommandResponse, right: UmtContentCommandResponse): number {
  const leftScore = frameResponseScore(left);
  const rightScore = frameResponseScore(right);
  return rightScore - leftScore;
}

function frameResponseScore(response: UmtContentCommandResponse): number {
  const state = response.state;
  return (response.ok ? 10000 : 0) + (state.readerActive ? 1000 : 0) + state.queue.total;
}

function noFrameResponse(): UmtContentCommandResponse {
  return {
    ok: false,
    error: "No reachable manga reader frame was found",
    state: { readerActive: false, overlayVisible: true, autoTranslate: false, queue: { total: 0, queued: 0, processing: 0, completed: 0, cached: 0, empty: 0, failed: 0, cancelled: 0, paused: false } },
  };
}

function noPageSampleResponse(): UmtPageSampleSelfTestResponse {
  return { ok: false, status: "no-reader-page", detail: "No reachable manga reader frame was found" };
}
