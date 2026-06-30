import test from "node:test";
import assert from "node:assert/strict";
import { BackendClient, createEventUrl, SurfaceSubmitTracker } from "./backend-client.js";

test("createEventUrl converts http backend url to websocket events url", () => {
  assert.equal(createEventUrl("http://127.0.0.1:47831"), "ws://127.0.0.1:47831/v1/events");
  assert.equal(createEventUrl("https://example.test/base/"), "wss://example.test/base/v1/events");
});

test("SurfaceSubmitTracker prevents duplicate surface submissions", () => {
  const tracker = new SurfaceSubmitTracker();
  assert.equal(tracker.shouldSubmit("s1"), true);
  tracker.markSubmitted("s1");
  assert.equal(tracker.shouldSubmit("s1"), false);
  tracker.clear();
  assert.equal(tracker.shouldSubmit("s1"), true);
});

test("BackendClient exposes events url", () => {
  assert.equal(new BackendClient("http://127.0.0.1:47831").eventsUrl(), "ws://127.0.0.1:47831/v1/events");
});
