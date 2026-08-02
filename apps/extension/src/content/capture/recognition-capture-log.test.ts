import test from "node:test";
import assert from "node:assert/strict";
import { captureWithRecognitionSummary } from "./recognition-capture-log.js";
import { createRecognitionCapture } from "./recognition-capture.js";

test("captureWithRecognitionSummary invokes automatic and manual capture APIs and logs only safe summaries", async () => {
  for (const captureSource of ["image-fetch", "manual-selection"] as const) {
    let captureCalls = 0;
    const logs: Array<{ message: string; detail?: string }> = [];
    const capture = createRecognitionCapture({
      parentSurfaceId: `surface:${captureSource}`,
      imageData: "data:image/png;base64,QVBJX0tFWV9zdXBlci1zZWNyZXQtdmFsdWU=",
      naturalSize: { width: 500, height: 800 },
      pixelSize: { width: 500, height: 800 },
      priority: captureSource === "manual-selection" ? "p0" : "p2",
      reason: captureSource === "manual-selection" ? "manual-selection" : "automatic",
      captureSource,
    });

    const result = await captureWithRecognitionSummary(
      async () => {
        captureCalls += 1;
        return { capture, marker: captureSource };
      },
      {
        info(message, detail) {
          logs.push({ message, ...(detail === undefined ? {} : { detail }) });
        },
      },
    );

    assert.equal(captureCalls, 1);
    assert.equal(result.marker, captureSource);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.message, "recognition capture");
    assert.match(logs[0]?.detail ?? "", new RegExp(`source=${captureSource}`));
    assert.doesNotMatch(JSON.stringify(logs), /imageData|base64|API_KEY|super-secret-value/);
  }
});
