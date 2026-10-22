import test from "node:test";
import assert from "node:assert/strict";
import {
  isControllerOnlyCommand,
  isRelayablePageCommand,
  isUmtContentCommand,
  isUmtPageInventoryResponse,
  type UmtContentCommandName,
} from "./messages.js";

test("the forced translation command reaches reader frames through the relay", () => {
  assert.equal(isRelayablePageCommand("forceTranslate"), true);
  assert.equal(isControllerOnlyCommand("forceTranslate"), false);
});

test("the inventory question is answered only by the frame that merges every queue", () => {
  assert.equal(isControllerOnlyCommand("pageInventory"), true);
  assert.equal(isRelayablePageCommand("pageInventory"), false);
});

test("an inventory response is rejected unless every counter is present", () => {
  const complete = { ok: true, detected: 3, queued: 3, forced: false, readerPage: true };
  assert.equal(isUmtPageInventoryResponse(complete), true);
  assert.equal(isUmtPageInventoryResponse({ ...complete, detected: undefined }), false);
  assert.equal(isUmtPageInventoryResponse({ ...complete, forced: "false" }), false);
  assert.equal(isUmtPageInventoryResponse(null), false);
});

test("the popup may only send commands the content script recognises", () => {
  assert.equal(isUmtContentCommand({ source: "umt-popup", command: "forceTranslate" }), true);
  assert.equal(isUmtContentCommand({ source: "umt-popup", command: "pageInventory" }), true);
  assert.equal(isUmtContentCommand({ source: "umt-popup", command: "setSurfaces" as UmtContentCommandName }), false);
});
