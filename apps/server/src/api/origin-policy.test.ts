import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedRequestOrigin, isAllowedServerHost } from "./origin-policy.js";

test("isAllowedRequestOrigin allows clients without an Origin header", () => {
  assert.equal(isAllowedRequestOrigin(undefined), true);
});

test("isAllowedRequestOrigin allows the extension and local desktop pages", () => {
  assert.equal(isAllowedRequestOrigin("chrome-extension://abcdefghijklmnop"), true);
  assert.equal(isAllowedRequestOrigin("null"), true);
  assert.equal(isAllowedRequestOrigin("file:///C:/app/index.html"), true);
  assert.equal(isAllowedRequestOrigin("http://localhost:47831"), true);
  assert.equal(isAllowedRequestOrigin("http://127.0.0.1:5173"), true);
});

test("isAllowedRequestOrigin rejects remote web origins", () => {
  assert.equal(isAllowedRequestOrigin("https://evil.example"), false);
  assert.equal(isAllowedRequestOrigin("http://evil.example"), false);
  assert.equal(isAllowedRequestOrigin("https://127.0.0.1.evil.example"), false);
  assert.equal(isAllowedRequestOrigin("not-a-url"), false);
});

test("isAllowedServerHost only accepts loopback hosts (DNS rebinding defense)", () => {
  assert.equal(isAllowedServerHost("127.0.0.1:47831"), true);
  assert.equal(isAllowedServerHost("localhost:47831"), true);
  assert.equal(isAllowedServerHost("[::1]:47831"), true);
  assert.equal(isAllowedServerHost("localhost"), true);
  assert.equal(isAllowedServerHost("evil.example:47831"), false);
  assert.equal(isAllowedServerHost("127.0.0.1.evil.example:47831"), false);
  assert.equal(isAllowedServerHost(""), false);
  assert.equal(isAllowedServerHost(undefined), false);
});
