import test from "node:test";
import assert from "node:assert/strict";
import { handleCaptureVisibleTabMessage } from "./capture.js";
import { isUmtCaptureVisibleTabRequest } from "../content/messages.js";

test("isUmtCaptureVisibleTabRequest validates screenshot capture requests", () => {
  assert.equal(isUmtCaptureVisibleTabRequest({ source: "umt-content", command: "captureVisibleTab" }), true);
  assert.equal(isUmtCaptureVisibleTabRequest({ source: "umt-popup", command: "captureVisibleTab" }), false);
  assert.equal(isUmtCaptureVisibleTabRequest({ source: "umt-content", command: "translate" }), false);
});

test("handleCaptureVisibleTabMessage returns captured data url", async () => {
  const response = await handleCaptureVisibleTabMessage(
    { source: "umt-content", command: "captureVisibleTab" },
    { tab: { windowId: 7 } as chrome.tabs.Tab },
    async (windowId: number, options: chrome.tabs.CaptureVisibleTabOptions) => {
      assert.equal(windowId, 7);
      assert.deepEqual(options, { format: "png" });
      return "data:image/png;base64,abc";
    },
  );

  assert.deepEqual(response, { ok: true, imageData: "data:image/png;base64,abc" });
});

test("handleCaptureVisibleTabMessage reports capture errors", async () => {
  const response = await handleCaptureVisibleTabMessage(
    { source: "umt-content", command: "captureVisibleTab" },
    { tab: { windowId: 1 } as chrome.tabs.Tab },
    async () => { throw new Error("denied"); },
  );

  assert.deepEqual(response, { ok: false, error: "denied" });
});
test("handleCaptureVisibleTabMessage reports empty capture data", async () => {
  const response = await handleCaptureVisibleTabMessage(
    { source: "umt-content", command: "captureVisibleTab" },
    { tab: { windowId: 1 } as chrome.tabs.Tab },
    async () => "",
  );

  assert.equal(response.ok, false);
  assert.match(response.ok ? "" : response.error, /empty screenshot/i);
});
