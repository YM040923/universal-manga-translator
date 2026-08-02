import type { ContentLogger } from "../content-logger.js";
import { formatRecognitionCaptureSummary, type RecognitionCapture } from "./recognition-capture.js";

export async function captureWithRecognitionSummary<T extends { capture: RecognitionCapture }>(
  captureApi: () => Promise<T>,
  logger: Pick<ContentLogger, "info">,
): Promise<T> {
  const result = await captureApi();
  logger.info("recognition capture", formatRecognitionCaptureSummary(result.capture));
  return result;
}
