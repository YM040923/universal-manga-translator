import test from "node:test";
import assert from "node:assert/strict";
import { handleActivateSiteMessage, injectContentScriptsIntoEnabledTabs, maybeInjectContentScriptForTab } from "./site-activation.js";
import { DEFAULT_SETTINGS, type SettingsStorageArea } from "../settings/settings.js";

test("handleActivateSiteMessage enables the primary domain and injects content script", async () => {
  const storage = fakeStorage();
  const injected: Array<{ tabId: number; files: string[] }> = [];

  const response = await handleActivateSiteMessage(
    { source: "umt-popup", command: "activateSite", tabId: 7, url: "https://www.asurascans.com/chapter/1" },
    { storage, executeScript: async (details: { tabId: number; files: string[] }) => { injected.push(details); } },
  );

  assert.deepEqual(response, { ok: true });
  assert.equal(storage.current.enabledSites["asurascans.com"], true);
  assert.deepEqual(injected, [{ tabId: 7, files: ["content.js"], allFrames: true }]);
});

test("maybeInjectContentScriptForTab injects only enabled http tabs", async () => {
  const storage = fakeStorage({ enabledSites: { "asurascans.com": true } });
  const injected: Array<{ tabId: number; files: string[] }> = [];

  await maybeInjectContentScriptForTab(5, "https://reader.asurascans.com/a", { storage, executeScript: async (details: { tabId: number; files: string[] }) => { injected.push(details); } });
  await maybeInjectContentScriptForTab(6, "https://other.example/a", { storage, executeScript: async (details: { tabId: number; files: string[] }) => { injected.push(details); } });
  await maybeInjectContentScriptForTab(7, "chrome://extensions", { storage, executeScript: async (details: { tabId: number; files: string[] }) => { injected.push(details); } });

  assert.deepEqual(injected, [{ tabId: 5, files: ["content.js"], allFrames: true }]);
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
    { tabId: 1, files: ["content.js"], allFrames: true },
    { tabId: 2, files: ["content.js"], allFrames: true },
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
