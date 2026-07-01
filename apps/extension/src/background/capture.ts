import { isUmtCaptureVisibleTabRequest, type UmtCaptureVisibleTabRequest, type UmtCaptureVisibleTabResponse } from "../content/messages.js";

export type CaptureVisibleTabFn = (windowId: number, options: chrome.tabs.CaptureVisibleTabOptions) => Promise<string>;

export async function handleCaptureVisibleTabMessage(
  message: UmtCaptureVisibleTabRequest,
  sender: chrome.runtime.MessageSender,
  captureVisibleTab: CaptureVisibleTabFn,
): Promise<UmtCaptureVisibleTabResponse> {
  try {
    const windowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
    const imageData = await captureVisibleTab(windowId, { format: "png" });
    if (!imageData || !imageData.startsWith("data:image/")) throw new Error("empty screenshot data from browser capture");
    return { ok: true, imageData };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerCaptureVisibleTabHandler(runtime: typeof chrome.runtime = chrome.runtime, tabs: typeof chrome.tabs = chrome.tabs): void {
  runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isUmtCaptureVisibleTabRequest(message)) return false;
    void handleCaptureVisibleTabMessage(message, sender, (windowId, options) => tabs.captureVisibleTab(windowId, options)).then(sendResponse);
    return true;
  });
}
