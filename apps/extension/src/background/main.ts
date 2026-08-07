import { registerCaptureVisibleTabHandler } from "./capture.js";
import {
  ROLLBACK_CACHE_CLEANUP_END_MS,
  ROLLBACK_CACHE_CLEANUP_START_MS,
  cleanupTranslationCachesForRange,
} from "./cache-cleanup.js";
import { registerSiteActivationHandlers } from "./site-activation.js";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Universal Manga Translator installed");
});

registerCaptureVisibleTabHandler();
registerSiteActivationHandlers();
void cleanupTranslationCachesForRange(
  chrome.storage.local,
  ROLLBACK_CACHE_CLEANUP_START_MS,
  ROLLBACK_CACHE_CLEANUP_END_MS,
).catch((error) => console.warn("Universal Manga Translator rollback cache cleanup failed", error));
