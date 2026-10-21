import { registerCaptureVisibleTabHandler } from "./capture.js";
import {
  ROLLBACK_CACHE_CLEANUP_END_MS,
  ROLLBACK_CACHE_CLEANUP_START_MS,
  cleanupTranslationCachesForRange,
} from "./cache-cleanup.js";
import { registerFrameOrchestrationHandlers } from "./frame-orchestration.js";
import { createScriptingInjectionDeps, injectContentScriptIntoTab, registerSiteActivationHandlers } from "./site-activation.js";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Universal Manga Translator installed");
});

registerCaptureVisibleTabHandler();
registerSiteActivationHandlers();
const injectionDeps = createScriptingInjectionDeps();
registerFrameOrchestrationHandlers({
  broadcastToTab: async (tabId, message) => await chrome.tabs.sendMessage(tabId, message),
  sendToFrame: async (tabId, frameId, message) => await chrome.tabs.sendMessage(tabId, message, { frameId }),
  getTabUrl: async (tabId) => (await chrome.tabs.get(tabId)).url,
  injectAllFrames: async (tabId) => { await injectContentScriptIntoTab(tabId, injectionDeps); },
});
void cleanupTranslationCachesForRange(
  chrome.storage.local,
  ROLLBACK_CACHE_CLEANUP_START_MS,
  ROLLBACK_CACHE_CLEANUP_END_MS,
).catch((error) => console.warn("Universal Manga Translator rollback cache cleanup failed", error));
