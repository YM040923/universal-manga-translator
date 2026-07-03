import test from "node:test";
import assert from "node:assert/strict";
import { handleActivateSiteMessage, maybeInjectContentScriptForTab } from "./site-activation.js";
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

function fakeStorage(initial: Record<string, unknown> = {}): SettingsStorageArea & { current: typeof DEFAULT_SETTINGS } {
  return {
    current: { ...structuredClone(DEFAULT_SETTINGS), ...initial },
    async get() { return this.current as unknown as Record<string, unknown>; },
    async set(value) { this.current = { ...this.current, ...value }; },
  };
}
