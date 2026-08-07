import { isUmtActivateSiteRequest, type UmtActivateSiteRequest, type UmtActivateSiteResponse } from "../content/messages.js";
import { enableSiteForUrl, isSiteEnabled, loadSettings, saveSettings, type SettingsStorageArea } from "../settings/settings.js";

export interface ContentScriptInjectionDeps {
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

export async function maybeInjectContentScriptForTab(tabId: number, url: string | undefined, deps: ContentScriptInjectionDeps): Promise<void> {
  if (!url) return;
  const settings = await loadSettings(deps.storage);
  if (!isSiteEnabled(settings, url)) return;
  await injectContentScript(tabId, deps);
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

export function registerSiteActivationHandlers(runtime: typeof chrome.runtime = chrome.runtime, tabs: typeof chrome.tabs = chrome.tabs, scripting: typeof chrome.scripting = chrome.scripting): void {
  const deps: ContentScriptInjectionDeps = { executeScript: async (details) => { await scripting.executeScript({ target: { tabId: details.tabId }, files: details.files }); } };
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

async function injectContentScript(tabId: number, deps: ContentScriptInjectionDeps): Promise<void> {
  await deps.executeScript({ tabId, files: ["content.js"] });
}
