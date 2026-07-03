import type { UmtFetchImageDataRequest, UmtFetchImageDataResponse } from "../messages.js";

export async function requestImageData(url: string, referer = location.href): Promise<string> {
  const response = await chrome.runtime.sendMessage({ source: "umt-content", command: "fetchImageData", url, referer } satisfies UmtFetchImageDataRequest) as UmtFetchImageDataResponse | undefined;
  if (!response?.ok) throw new Error(response?.error || "image data fetch unavailable");
  return response.imageData;
}
