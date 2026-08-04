import test from "node:test";
import assert from "node:assert/strict";
import { isUmtContentCommand } from "./messages.js";

test("getPageState is a valid content command", () => {
  assert.equal(isUmtContentCommand({ source: "umt-popup", command: "getPageState" }), true);
});
