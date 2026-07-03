import { isUmtActivateSiteRequest, type UmtActivateSiteRequest, type UmtActivateSiteResponse } from "../content/messages.js";
import { enableSiteForUrl, isSiteEnabled, loadSettings, saveSettings, type SettingsStorageArea } from "../settings/settings.js";

export interface ContentScriptInjectionDeps {
  storage?: SettingsStorageArea;
  executeScript: (details: { tabId: number; files: string[] }) => Promise<void> | void;
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
}

async function injectContentScript(tabId: number, deps: ContentScriptInjectionDeps): Promise<void> {
  await deps.executeScript({ tabId, files: ["content.js"] });
}
