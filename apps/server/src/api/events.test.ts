import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
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

async function openEventSocket(port: number, sessionId: string | null): Promise<WebSocket> {
  const url = sessionId ? `ws://127.0.0.1:${port}/v1/events?sessionId=${sessionId}` : `ws://127.0.0.1:${port}/v1/events`;
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("websocket failed")));
  });
  return socket;
}

async function createSession(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/v1/session", payload: {} });
  assert.equal(response.statusCode, 200);
  return String(response.json().sessionId);
}

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
    ws = await openEventSocket(port, await createSession(app));
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

test("websocket without an issued event session is refused", async () => {
  const app = await buildServer({ provider: "test-pipeline", targetLanguage: "zh-CN", visionProvider: { profile: "test-pipeline", process: async () => [] } });
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.equal(typeof address, "object");
    const port = address && typeof address === "object" ? address.port : 0;
    await assert.rejects(openEventSocket(port, null), /websocket failed/);
    await assert.rejects(openEventSocket(port, "guessed-session-id"), /websocket failed/);
  } finally {
    await app.close();
  }
});


