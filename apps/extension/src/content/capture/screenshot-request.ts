import type { UmtCaptureVisibleTabRequest, UmtCaptureVisibleTabResponse } from "../messages.js";

export interface ScreenshotRequestRuntime {
  sendMessage(message: UmtCaptureVisibleTabRequest): Promise<UmtCaptureVisibleTabResponse>;
}

export async function requestVisibleTabScreenshot(runtime: ScreenshotRequestRuntime = chrome.runtime): Promise<string> {
  const response = await runtime.sendMessage({ source: "umt-content", command: "captureVisibleTab" });
  if (!response.ok) throw new Error(response.error);
  if (!response.imageData || !response.imageData.startsWith("data:image/")) throw new Error("empty screenshot data from browser capture");
  return response.imageData;
}
