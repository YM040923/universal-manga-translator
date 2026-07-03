import { registerCaptureVisibleTabHandler } from "./capture.js";
import { registerSiteActivationHandlers } from "./site-activation.js";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Universal Manga Translator installed");
});

registerCaptureVisibleTabHandler();
registerSiteActivationHandlers();
