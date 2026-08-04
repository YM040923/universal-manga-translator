import test from "node:test";
import assert from "node:assert/strict";
import { handleActivateSiteMessage, injectContentScriptsIntoEnabledTabs, maybeInjectContentScriptForEmbeddedFrame, maybeInjectContentScriptForTab } from "./site-activation.js";
import { DEFAULT_SETTINGS, type SettingsStorageArea } from "../settings/settings.js";

test("handleActivateSiteMessage enables the primary domain and injects content script", async () => {
  const storage = fakeStorage();
  const injected: Array<{ tabId: number; files: string[]; allFrames?: boolean }> = [];

  const response = await handleActivateSiteMessage(
    { source: "umt-popup", command: "activateSite", tabId: 7, url: "https://www.asurascans.com/chapter/1" },
    { storage, executeScript: async (details) => { injected.push(details); } },
  );

  assert.deepEqual(response, { ok: true });
  assert.equal(storage.current.enabledSites["asurascans.com"], true);
  assert.deepEqual(injected, [{ tabId: 7, files: ["content.js"], allFrames: true }]);
});

test("maybeInjectContentScriptForTab injects only enabled http tabs", async () => {
  const storage = fakeStorage({ enabledSites: { "asurascans.com": true } });
  const injected: Array<{ tabId: number; files: string[]; allFrames?: boolean }> = [];

  await maybeInjectContentScriptForTab(5, "https://reader.asurascans.com/a", { storage, executeScript: async (details) => { injected.push(details); } });
  await maybeInjectContentScriptForTab(6, "https://other.example/a", { storage, executeScript: async (details) => { injected.push(details); } });
  await maybeInjectContentScriptForTab(7, "chrome://extensions", { storage, executeScript: async (details) => { injected.push(details); } });

  assert.deepEqual(injected, [{ tabId: 5, files: ["content.js"], allFrames: true }]);
});

test("injects an embedded reader frame that is added after its enabled tab has loaded", async () => {
  const storage = fakeStorage({ enabledSites: { "manga.example": true } });
  const injected: Array<{ tabId: number; files: string[]; allFrames?: boolean }> = [];

  await maybeInjectContentScriptForEmbeddedFrame(14, 6, {
    storage,
    getTab: async () => ({ url: "https://manga.example/title/chapter/60" }),
    executeScript: async (details: { tabId: number; files: string[]; allFrames?: boolean }) => { injected.push(details); },
  });
  await maybeInjectContentScriptForEmbeddedFrame(14, 0, {
    storage,
    getTab: async () => ({ url: "https://manga.example/title/chapter/60" }),
    executeScript: async (details: { tabId: number; files: string[]; allFrames?: boolean }) => { injected.push(details); },
  });

  assert.deepEqual(injected, [{ tabId: 14, files: ["content.js"], allFrames: true }]);
});

test("injectContentScriptsIntoEnabledTabs restores enabled manga tabs after extension reload", async () => {
  const storage = fakeStorage({ enabledSites: { "asurascans.com": true } });
  const injected: Array<{ tabId: number; files: string[]; allFrames?: boolean }> = [];

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

test("authorizes an embedded reader frame from its enabled top-level tab", async () => {
  const activation = await import("./site-activation.js") as unknown as {
    authorizeEmbeddedFrame?: (sender: chrome.runtime.MessageSender, deps: { storage?: SettingsStorageArea; getTab: (tabId: number) => Promise<{ url?: string }> }) => Promise<unknown>;
  };
  const storage = fakeStorage({ enabledSites: { "manga.example": true } });

  assert.equal(typeof activation.authorizeEmbeddedFrame, "function");
  const result = await activation.authorizeEmbeddedFrame!(
    { tab: { id: 18 } } as chrome.runtime.MessageSender,
    { storage, getTab: async () => ({ url: "https://manga.example/title/chapter/60" }) },
  );

  assert.deepEqual(result, { ok: true, siteUrl: "https://manga.example/title/chapter/60" });
});

test("routes popup commands to every injected frame and returns the active reader state", async () => {
  const activation = await import("./site-activation.js") as unknown as {
    dispatchContentCommandToFrames?: (input: { tabId: number; message: { source: "umt-popup"; command: "translate" } }, deps: {
      getAllFrames: (details: { tabId: number }) => Promise<Array<{ frameId: number }>>;
      sendMessage: (tabId: number, message: unknown, options: { frameId: number }) => Promise<unknown>;
    }) => Promise<unknown>;
  };
  const calls: number[] = [];

  assert.equal(typeof activation.dispatchContentCommandToFrames, "function");
  const result = await activation.dispatchContentCommandToFrames!(
    { tabId: 18, message: { source: "umt-popup", command: "translate" } },
    {
      getAllFrames: async () => [{ frameId: 0 }, { frameId: 2 }, { frameId: 5 }],
      sendMessage: async (_tabId, _message, options) => {
        calls.push(options.frameId);
        if (options.frameId === 2) throw new Error("frame navigated");
        return options.frameId === 5
          ? { ok: true, state: { readerActive: true, overlayVisible: true, autoTranslate: false, queue: { total: 3, queued: 2, processing: 1, completed: 0, cached: 0, empty: 0, failed: 0, cancelled: 0, paused: false } } }
          : { ok: true, state: { readerActive: false, overlayVisible: true, autoTranslate: false, queue: { total: 0, queued: 0, processing: 0, completed: 0, cached: 0, empty: 0, failed: 0, cancelled: 0, paused: false } } };
      },
    },
  );

  assert.deepEqual(calls, [0, 2, 5]);
  assert.deepEqual(result, { ok: true, state: { readerActive: true, overlayVisible: true, autoTranslate: false, queue: { total: 3, queued: 2, processing: 1, completed: 0, cached: 0, empty: 0, failed: 0, cancelled: 0, paused: false } } });
});

test("routes OCR self-test to an embedded reader and returns its sample result", async () => {
  const activation = await import("./site-activation.js") as unknown as {
    dispatchContentCommandToFrames?: (input: { tabId: number; message: { source: "umt-popup"; command: "sampleOcrSelfTest" } }, deps: {
      getAllFrames: (details: { tabId: number }) => Promise<Array<{ frameId: number }>>;
      sendMessage: (tabId: number, message: unknown, options: { frameId: number }) => Promise<unknown>;
    }) => Promise<unknown>;
  };

  assert.equal(typeof activation.dispatchContentCommandToFrames, "function");
  const result = await activation.dispatchContentCommandToFrames!(
    { tabId: 18, message: { source: "umt-popup", command: "sampleOcrSelfTest" } },
    {
      getAllFrames: async () => [{ frameId: 0 }, { frameId: 4 }],
      sendMessage: async (_tabId, _message, options) => options.frameId === 4
        ? { ok: true, status: "ok", surfaceIndex: 1, regionCount: 6, elapsedMs: 880 }
        : { ok: false, status: "no-reader-page", detail: "当前页面不是漫画阅读页" },
    },
  );

  assert.deepEqual(result, { ok: true, status: "ok", surfaceIndex: 1, regionCount: 6, elapsedMs: 880 });
});
