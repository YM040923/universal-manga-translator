import test from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server.js";
import { EventBus } from "./events.js";

const task = {
  surfaceId: "surface-events",
  pageUrl: "https://example.test/chapter/1",
  domain: "example.test",
  imageData: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg==",
  viewportPriority: "p0",
  surfaceRect: { x: 0, y: 0, width: 600, height: 800 },
  naturalSize: { width: 600, height: 800 },
  renderSize: { width: 600, height: 800 },
  readingDirection: "auto",
  sourceLanguage: "auto",
  targetLanguage: "zh-CN",
} as const;

test("websocket receives submit lifecycle events", async () => {
  const eventBus = new EventBus();
  const app = await buildServer({ provider: "test-pipeline", targetLanguage: "zh-CN", eventBus, visionProvider: { profile: "test-pipeline", process: async () => [{ id: "r1", box: { x: 1, y: 1, width: 4, height: 4 }, sourceText: "Hello", translatedText: "测试译文", confidence: 1, orientation: "horizontal", kind: "dialogue" }] } });
  let ws: WebSocket | null = null;
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.equal(typeof address, "object");
    const port = address && typeof address === "object" ? address.port : 0;
    const events: string[] = [];
    ws = new WebSocket(`ws://127.0.0.1:${port}/v1/events`);
    await new Promise<void>((resolve, reject) => { ws?.addEventListener("open", () => resolve()); ws?.addEventListener("error", () => reject(new Error("websocket failed"))); });
    ws.addEventListener("message", (message) => { events.push(JSON.parse(String(message.data)).type); });
    const response = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task } });
    assert.equal(response.statusCode, 200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(events.filter((type) => type.startsWith("job.")), ["job.queued", "job.processing", "job.completed"]);
  } finally {
    ws?.close();
    await app.close();
  }
});


