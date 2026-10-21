import { isUmtActivateSiteRequest, type UmtActivateSiteRequest, type UmtActivateSiteResponse } from "../content/messages.js";
import { defaultSettingsStores, enableSiteForUrl, isSiteEnabled, loadSettings, saveSettings, singleAreaStores, type SettingsStorageArea, type SettingsStores } from "../settings/settings.js";

export interface ContentScriptInjectionDeps {
  /** Test seam: a single area backing both preferences and secrets. */
  storage?: SettingsStorageArea;
  executeScript: (details: { tabId: number; files: string[] }) => Promise<void> | void;
}

export interface InjectableTab {
  id?: number;
  url?: string;
}

export interface TabQueryDeps extends ContentScriptInjectionDeps {
  queryTabs: () => Promise<InjectableTab[]> | InjectableTab[];
}

function resolveStores(deps: ContentScriptInjectionDeps): SettingsStores {
  return deps.storage ? singleAreaStores(deps.storage) : defaultSettingsStores();
}

export async function handleActivateSiteMessage(message: UmtActivateSiteRequest, deps: ContentScriptInjectionDeps): Promise<UmtActivateSiteResponse> {
  try {
    const stores = resolveStores(deps);
    const settings = await loadSettings(stores);
    const next = enableSiteForUrl(settings, message.url);
    await saveSettings(next, stores);
    await injectContentScriptIntoTab(message.tabId, deps);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function maybeInjectContentScriptForTab(tabId: number, url: string | undefined, deps: ContentScriptInjectionDeps): Promise<void> {
  if (!url) return;
  const settings = await loadSettings(resolveStores(deps));
  if (!isSiteEnabled(settings, url)) return;
  await injectContentScriptIntoTab(tabId, deps);
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

export function createScriptingInjectionDeps(scripting: typeof chrome.scripting = chrome.scripting): ContentScriptInjectionDeps {
  return {
    // Embedded readers keep their pages inside frames the top document cannot reach, so an
    // enabled tab is injected as a whole. Each frame still asks the worker whether it may run.
    executeScript: async (details) => { await scripting.executeScript({ target: { tabId: details.tabId, allFrames: true }, files: details.files }); },
  };
}

export function registerSiteActivationHandlers(runtime: typeof chrome.runtime = chrome.runtime, tabs: typeof chrome.tabs = chrome.tabs, scripting: typeof chrome.scripting = chrome.scripting): void {
  const deps = createScriptingInjectionDeps(scripting);
  runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isUmtActivateSiteRequest(message)) return false;
    void handleActivateSiteMessage(message, deps).then(sendResponse);
    return true;
  });
  tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    void maybeInjectContentScriptForTab(tabId, tab.url, deps);
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

/** Injects into every frame of one tab; whether the site is enabled stays the caller's decision. */
export async function injectContentScriptIntoTab(tabId: number, deps: ContentScriptInjectionDeps): Promise<void> {
  await deps.executeScript({ tabId, files: ["content.js"] });
}
