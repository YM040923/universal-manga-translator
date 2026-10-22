import test from "node:test";
import assert from "node:assert/strict";
import { createScriptingInjectionDeps, handleActivateSiteMessage, injectContentScriptsIntoEnabledTabs, maybeInjectContentScriptForFrame, maybeInjectContentScriptForTab, registerFrameNavigationInjection } from "./site-activation.js";
import { DEFAULT_SETTINGS, type SettingsStorageArea } from "../settings/settings.js";

test("createScriptingInjectionDeps reaches the frames an embedded reader keeps its pages in", async () => {
  const calls: Array<{ target: unknown; files: string[] }> = [];
  const scripting = { executeScript: async (details: { target: unknown; files: string[] }) => { calls.push(details); } } as unknown as typeof chrome.scripting;

  await createScriptingInjectionDeps(scripting).executeScript({ tabId: 12, files: ["content.js"] });

  assert.deepEqual(calls, [{ target: { tabId: 12, allFrames: true }, files: ["content.js"] }]);
});

test("createScriptingInjectionDeps addresses one navigating frame without restarting the others", async () => {
  const calls: Array<{ target: unknown; files: string[] }> = [];
  const scripting = { executeScript: async (details: { target: unknown; files: string[] }) => { calls.push(details); } } as unknown as typeof chrome.scripting;

  await createScriptingInjectionDeps(scripting).executeScript({ tabId: 12, frameId: 7, files: ["content.js"] });

  assert.deepEqual(calls, [{ target: { tabId: 12, frameIds: [7] }, files: ["content.js"] }]);
});

test("handleActivateSiteMessage enables the primary domain and injects content script", async () => {
  const storage = fakeStorage();
  const injected: Array<{ tabId: number; files: string[] }> = [];

  const response = await handleActivateSiteMessage(
    { source: "umt-popup", command: "activateSite", tabId: 7, url: "https://www.asurascans.com/chapter/1" },
    { storage, executeScript: async (details: { tabId: number; files: string[] }) => { injected.push(details); } },
  );

  assert.deepEqual(response, { ok: true });
  assert.equal(storage.current.enabledSites["asurascans.com"], true);
  assert.deepEqual(injected, [{ tabId: 7, files: ["content.js"] }]);
});

test("maybeInjectContentScriptForTab injects only enabled http tabs", async () => {
  const storage = fakeStorage({ enabledSites: { "asurascans.com": true } });
  const injected: Array<{ tabId: number; files: string[] }> = [];

  await maybeInjectContentScriptForTab(5, "https://reader.asurascans.com/a", { storage, executeScript: async (details: { tabId: number; files: string[] }) => { injected.push(details); } });
  await maybeInjectContentScriptForTab(6, "https://other.example/a", { storage, executeScript: async (details: { tabId: number; files: string[] }) => { injected.push(details); } });
  await maybeInjectContentScriptForTab(7, "chrome://extensions", { storage, executeScript: async (details: { tabId: number; files: string[] }) => { injected.push(details); } });

  assert.deepEqual(injected, [{ tabId: 5, files: ["content.js"] }]);
});

test("maybeInjectContentScriptForFrame re-injects a navigating reader frame of an enabled site", async () => {
  const storage = fakeStorage({ enabledSites: { "asurascans.com": true } });
  const injected: Array<{ tabId: number; frameId?: number; files: string[] }> = [];
  const deps = { storage, executeScript: async (details: { tabId: number; frameId?: number; files: string[] }) => { injected.push(details); } };

  await maybeInjectContentScriptForFrame(5, 3, "https://asurascans.com/chapter/1", deps);
  await maybeInjectContentScriptForFrame(6, 3, "https://other.example/chapter/1", deps);
  await maybeInjectContentScriptForFrame(7, 0, "https://asurascans.com/chapter/1", deps);

  assert.deepEqual(injected, [{ tabId: 5, frameId: 3, files: ["content.js"] }]);
});

test("frame navigation listeners re-inject only the frame of an enabled tab", async () => {
  const storage = fakeStorage({ enabledSites: { "asurascans.com": true } });
  const injected: Array<{ tabId: number; frameId?: number | undefined }> = [];
  const listeners: Array<(details: { tabId: number; frameId: number }) => void> = [];
  const webNavigation = {
    onCompleted: { addListener: (listener: (details: { tabId: number; frameId: number }) => void) => { listeners.push(listener); } },
    onHistoryStateUpdated: { addListener: (listener: (details: { tabId: number; frameId: number }) => void) => { listeners.push(listener); } },
  };

  registerFrameNavigationInjection(
    { storage, executeScript: async (details: { tabId: number; frameId?: number }) => { injected.push({ tabId: details.tabId, frameId: details.frameId }); } },
    { get: async (tabId: number) => ({ url: tabId === 8 ? "https://other.example/a" : "https://asurascans.com/chapter/1" }) },
    webNavigation,
  );
  assert.equal(listeners.length, 2);

  listeners[0]!({ tabId: 9, frameId: 3 });
  listeners[1]!({ tabId: 8, frameId: 4 });
  listeners[0]!({ tabId: 9, frameId: 0 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(injected, [{ tabId: 9, frameId: 3 }]);
});

test("injectContentScriptsIntoEnabledTabs restores enabled manga tabs after extension reload", async () => {
  const storage = fakeStorage({ enabledSites: { "asurascans.com": true } });
  const injected: Array<{ tabId: number; files: string[] }> = [];

  await injectContentScriptsIntoEnabledTabs({
    storage,
    queryTabs: async () => [
      { id: 1, url: "https://asurascans.com/comics/a/chapter/1" },
      { id: 2, url: "https://reader.asurascans.com/comics/a/chapter/2" },
      { id: 3, url: "https://example.com/comics/a/chapter/1" },
      { url: "https://asurascans.com/no-tab-id" },
    ],
    executeScript: async (details) => { injected.push(details); },
  });

  assert.deepEqual(injected, [
    { tabId: 1, files: ["content.js"] },
    { tabId: 2, files: ["content.js"] },
  ]);
});

test("injectContentScriptsIntoEnabledTabs ignores individual restricted-tab injection failures", async () => {
  const storage = fakeStorage({ enabledSites: { "asurascans.com": true, "example.com": true } });
  const injected: number[] = [];

  await injectContentScriptsIntoEnabledTabs({
    storage,
    queryTabs: async () => [
      { id: 1, url: "https://asurascans.com/comics/a/chapter/1" },
      { id: 2, url: "https://example.com/comics/a/chapter/1" },
    ],
    executeScript: async (details) => {
      injected.push(details.tabId);
      if (details.tabId === 1) throw new Error("Cannot access contents of the page");
    },
  });

  assert.deepEqual(injected, [1, 2]);
});

function fakeStorage(initial: Record<string, unknown> = {}): SettingsStorageArea & { current: typeof DEFAULT_SETTINGS } {
  return {
    current: { ...structuredClone(DEFAULT_SETTINGS), ...initial },
    async get() { return this.current as unknown as Record<string, unknown>; },
    async set(value) { this.current = { ...this.current, ...value }; },
  };
}
