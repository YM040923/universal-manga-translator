import { isUmtActivateSiteRequest, type UmtActivateSiteRequest, type UmtActivateSiteResponse } from "../content/messages.js";
import { defaultSettingsStores, enableSiteForUrl, isSiteEnabled, loadSettings, saveSettings, singleAreaStores, type SettingsStorageArea, type SettingsStores } from "../settings/settings.js";

export interface ContentScriptInjectionDeps {
  /** Test seam: a single area backing both preferences and secrets. */
  storage?: SettingsStorageArea;
  executeScript: (details: { tabId: number; frameId?: number; files: string[] }) => Promise<void> | void;
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
  await injectForEnabledSite(tabId, url, deps);
}

/**
 * A reader frame that navigates itself gets a new document with no content script, and
 * `tabs.onUpdated` only reports the main frame, so the pages would stay untranslated until the
 * reader reloads the tab. The frame's own URL is irrelevant here: the grant is the tab's domain.
 */
export async function maybeInjectContentScriptForFrame(tabId: number, frameId: number, url: string | undefined, deps: ContentScriptInjectionDeps): Promise<void> {
  if (frameId === 0) return;
  await injectForEnabledSite(tabId, url, deps, frameId);
}

async function injectForEnabledSite(tabId: number, url: string | undefined, deps: ContentScriptInjectionDeps, frameId?: number): Promise<void> {
  if (!url) return;
  const settings = await loadSettings(resolveStores(deps));
  if (!isSiteEnabled(settings, url)) return;
  await deps.executeScript({ tabId, ...(typeof frameId === "number" ? { frameId } : {}), files: ["content.js"] });
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
    // A navigating frame is addressed on its own: re-running every frame would restart the queues
    // of the pages the reader is already looking at.
    executeScript: async (details) => {
      const target = typeof details.frameId === "number" ? { tabId: details.tabId, frameIds: [details.frameId] } : { tabId: details.tabId, allFrames: true };
      await scripting.executeScript({ target, files: details.files });
    },
  };
}

/** The two navigation events that can leave a reader frame with a fresh, scriptless document. */
export interface FrameNavigationEvents {
  onCompleted: { addListener: (listener: (details: { tabId: number; frameId: number }) => void) => void };
  onHistoryStateUpdated: { addListener: (listener: (details: { tabId: number; frameId: number }) => void) => void };
}

export interface TabUrlReader {
  get: (tabId: number) => Promise<{ url?: string | undefined }>;
}

/**
 * `tabs.onUpdated` only reports the main frame, so a reader that navigates inside its own iframe
 * loses the content script until the reader reloads the tab. The grant is looked up on the tab URL,
 * never on the frame URL the navigation happened to report.
 */
export function registerFrameNavigationInjection(deps: ContentScriptInjectionDeps, tabs: TabUrlReader, webNavigation: FrameNavigationEvents): void {
  const onFrameNavigated = (details: { tabId: number; frameId: number }): void => {
    if (details.frameId === 0) return;
    void tabs.get(details.tabId)
      .then((tab) => maybeInjectContentScriptForFrame(details.tabId, details.frameId, tab.url, deps))
      .catch(() => undefined);
  };
  webNavigation.onCompleted.addListener(onFrameNavigated);
  webNavigation.onHistoryStateUpdated.addListener(onFrameNavigated);
}

export function registerSiteActivationHandlers(
  runtime: typeof chrome.runtime = chrome.runtime,
  tabs: typeof chrome.tabs = chrome.tabs,
  scripting: typeof chrome.scripting = chrome.scripting,
  webNavigation: typeof chrome.webNavigation | undefined = chrome.webNavigation,
): void {
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
  // An unpacked build that predates this permission keeps working without it; the frame simply
  // waits for the next full tab load, exactly as before.
  if (webNavigation) registerFrameNavigationInjection(deps, tabs, webNavigation);
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
