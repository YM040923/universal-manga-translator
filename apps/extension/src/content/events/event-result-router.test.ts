import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EventResultRouter } from "./event-result-router.js";
import type { SurfaceResult } from "@umt/shared/types";

test("EventResultRouter renders completed event results for tracked surfaces", () => {
  const dom = new JSDOM("<body><img id='page'></body>", { url: "https://manga.example/chapter/1" });
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  const img = document.querySelector<HTMLElement>("#page")!;
  const calls: unknown[] = [];
  const router = new EventResultRouter({
    render: (element, naturalSize, result) => calls.push({ element, naturalSize, result }),
  });

  router.track("img:1:https://cdn.example/page.webp", img, { width: 800, height: 12000 });
  router.handle({
    type: "job.completed",
    surfaceId: "img:1:https://cdn.example/page.webp",
    result: fakeResult("img:1:https://cdn.example/page.webp"),
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    element: img,
    naturalSize: { width: 800, height: 12000 },
    result: fakeResult("img:1:https://cdn.example/page.webp"),
  });
});

test("EventResultRouter ignores empty or unknown event results", () => {
  const dom = new JSDOM("<body><img id='page'></body>");
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  const img = document.querySelector<HTMLElement>("#page")!;
  let renderCount = 0;
  const router = new EventResultRouter({
    render: () => { renderCount += 1; },
  });

  router.track("known", img, { width: 800, height: 12000 });
  router.handle({ type: "job.completed", surfaceId: "known", result: { ...fakeResult("known"), status: "empty", regions: [] } });
  router.handle({ type: "job.completed", surfaceId: "unknown", result: fakeResult("unknown") });

  assert.equal(renderCount, 0);
});


test("EventResultRouter ignores stale events after clear or session rotation", () => {
  const dom = new JSDOM("<body><img id='page'></body>");
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  const img = document.querySelector<HTMLElement>("#page")!;
  let renderCount = 0;
  const router = new EventResultRouter({ render: () => { renderCount += 1; } });

  router.setSession("session-a");
  router.track("known", img, { width: 800, height: 12000 });
  router.clear();
  assert.equal(router.handle({ type: "job.completed", surfaceId: "known", jobSessionId: "session-a", result: fakeResult("known") }), false);

  router.setSession("session-b");
  router.track("known", img, { width: 800, height: 12000 });
  assert.equal(router.handle({ type: "job.completed", surfaceId: "known", jobSessionId: "session-a", result: fakeResult("known") }), false);
  assert.equal(router.handle({ type: "job.completed", surfaceId: "known", jobSessionId: "session-b", result: fakeResult("known") }), true);
  assert.equal(renderCount, 1);
});
function fakeResult(surfaceId: string): SurfaceResult {
  return {
    surfaceId,
    imageHash: "hash",
    status: "completed",
    providerProfile: "generic-ocr:image_base64+openai-compatible:gpt-5.4-mini",
    layoutVersion: 1,
    elapsedMs: 45000,
    regions: [{
      id: "r1",
      box: { x: 10, y: 20, width: 100, height: 50 },
      sourceText: "Hello",
      translatedText: "你好",
      confidence: 0.9,
      orientation: "horizontal",
      kind: "dialogue",
      style: { fontSize: 18, writingMode: "horizontal-tb", align: "center", background: "#fff", color: "#111" },
    }],
  };
}

