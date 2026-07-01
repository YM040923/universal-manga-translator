import test from "node:test";
import assert from "node:assert/strict";
import { requestVisibleTabScreenshot } from "./screenshot-request.js";

test("requestVisibleTabScreenshot sends capture message and returns image data", async () => {
  const calls: unknown[] = [];
  const imageData = await requestVisibleTabScreenshot({
    sendMessage: async (message: unknown) => {
      calls.push(message);
      return { ok: true, imageData: "data:image/png;base64,abc" };
    },
  });

  assert.equal(imageData, "data:image/png;base64,abc");
  assert.deepEqual(calls[0], { source: "umt-content", command: "captureVisibleTab" });
});

test("requestVisibleTabScreenshot throws capture failure message", async () => {
  await assert.rejects(
    requestVisibleTabScreenshot({ sendMessage: async () => ({ ok: false, error: "denied" }) }),
    /denied/,
  );
});

