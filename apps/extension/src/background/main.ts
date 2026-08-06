import { cleanupTranslationCachesForDate } from "./cache-cleanup.js";
import { registerCaptureVisibleTabHandler } from "./capture.js";
import { registerSiteActivationHandlers } from "./site-activation.js";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Universal Manga Translator installed");
});

registerCaptureVisibleTabHandler();
registerSiteActivationHandlers();
void cleanupTranslationCachesForDate(chrome.storage.local, 1785945600000, 1786032000000).catch((error) => {
  console.error("Universal Manga Translator rollback cache cleanup failed", error);
});
