import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type { UpdateConfigRequest } from "@umt/shared";
import { loadConfig, mergeConfigPatch, type ServerConfig } from "../config/env.js";
import type { VisionProvider } from "../providers/provider.js";
import { buildServer } from "./server.js";
import { createEventSessionGate, eventSessionIdFromUrl, requestPath } from "./request-guard.js";

const stubProvider: VisionProvider = { profile: "guard-test", process: async () => [] };

function serverStateFor(config: ServerConfig) {
  return {
    provider: config.provider,
    targetLanguage: config.targetLanguage,
    visionProvider: stubProvider,
    maxImageLongEdge: config.maxImageLongEdge,
    jpegQuality: config.jpegQuality,
    openAICompatibleBaseUrl: config.openaiBaseUrl,
    openAIModel: config.openaiModel,
    openAIApiKeyConfigured: true,
    ocrApiUrl: config.ocrApiUrl,
    ocrEndpoint: config.ocrApiUrl,
    ocrInputMode: config.ocrInputMode,
    ocrInput: config.ocrInputMode,
    ocrImageField: config.ocrImageField,
    ocrStaticFields: config.ocrStaticFields,
    ocrRegionsPaths: config.ocrRegionsPaths,
    ocrTextPaths: config.ocrTextPaths,
    ocrBoxPaths: config.ocrBoxPaths,
    ocrConfidencePaths: config.ocrConfidencePaths,
    configWritable: true,
  };
}

async function guardedApp(): Promise<FastifyInstance & { writes: UpdateConfigRequest[] }> {
  let config = loadConfig({ OCR_API_URL: "https://ocr.example.test/ocr" });
  const writes: UpdateConfigRequest[] = [];
  const app = await buildServer({
    ...serverStateFor(config),
    updateConfig: async (patch) => {
      config = mergeConfigPatch(config, patch);
      writes.push(patch);
      return serverStateFor(config);
    },
  });
  return Object.assign(app, { writes });
}

test("event session gate accepts only issued ids until they expire", () => {
  const gate = createEventSessionGate({ ttlMs: 50 });
  const sessionId = gate.create();
  assert.equal(gate.accept(sessionId), true);
  assert.equal(gate.accept(`${sessionId}-guess`), false);
  assert.equal(gate.accept(undefined), false);
  assert.equal(gate.accept(""), false);
  assert.notEqual(gate.create(), sessionId);
});

test("event session gate evicts the oldest session once it is full", () => {
  const gate = createEventSessionGate({ maxSessions: 2 });
  const first = gate.create();
  gate.create();
  const third = gate.create();
  assert.equal(gate.accept(first), false, "oldest session is evicted");
  assert.equal(gate.accept(third), true);
});

test("guard helpers read the session id out of the websocket URL", () => {
  assert.equal(requestPath("/v1/events?sessionId=abc"), "/v1/events");
  assert.equal(eventSessionIdFromUrl("/v1/events?sessionId=abc"), "abc");
  assert.equal(eventSessionIdFromUrl("/v1/events"), undefined);
});

test("webpage origins cannot read or drive the backend", async () => {
  const app = await guardedApp();
  const headers = { origin: "https://reader.example" };

  const status = await app.inject({ method: "GET", url: "/v1/config/status", headers });
  const submit = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task: {} }, headers });

  assert.equal(status.statusCode, 403);
  assert.equal(submit.statusCode, 403);
  assert.equal(status.headers["access-control-allow-origin"], undefined);
  await app.close();
});

test("extension origins may read status and open an event session", async () => {
  const app = await guardedApp();
  const headers = { origin: "chrome-extension://abcdefghijklmnop" };

  const status = await app.inject({ method: "GET", url: "/v1/config/status", headers });
  const session = await app.inject({ method: "POST", url: "/v1/session", payload: {}, headers });

  assert.equal(status.statusCode, 200);
  assert.equal(status.headers["access-control-allow-origin"], "chrome-extension://abcdefghijklmnop");
  assert.equal(session.statusCode, 200);
  assert.match(String(session.json().sessionId), /^[0-9a-f-]{36}$/);
  await app.close();
});

test("only local processes without a browser origin may change backend configuration", async () => {
  const app = await guardedApp();

  const fromExtension = await app.inject({ method: "POST", url: "/v1/config", payload: { targetLanguage: "zh-TW" }, headers: { origin: "chrome-extension://abcdefghijklmnop" } });
  const fromPage = await app.inject({ method: "POST", url: "/v1/config", payload: { targetLanguage: "zh-TW" }, headers: { origin: "https://reader.example" } });
  const fromLocalProcess = await app.inject({ method: "POST", url: "/v1/config", payload: { targetLanguage: "zh-TW" } });

  assert.equal(fromExtension.statusCode, 403);
  assert.equal(fromPage.statusCode, 403);
  assert.equal(fromLocalProcess.statusCode, 200);
  assert.equal(app.writes.length, 1, "rejected config writes never reach the .env writer");
  await app.close();
});

test("non-loopback Host headers are refused (DNS rebinding defense)", async () => {
  const app = await guardedApp();
  const response = await app.inject({ method: "GET", url: "/v1/config/status", headers: { host: "attacker.example:47831" } });

  assert.equal(response.statusCode, 403);
  assert.match(response.json().error, /loopback/i);
  await app.close();
});

test("mutating backend routes require a JSON body", async () => {
  const app = await guardedApp();
  const response = await app.inject({ method: "POST", url: "/v1/cache/clear", payload: "{}", headers: { "content-type": "text/plain" } });

  assert.equal(response.statusCode, 415);
  await app.close();
});

test("config rejects plaintext http endpoints that would leak API keys", async () => {
  const app = await guardedApp();

  const cleartext = await app.inject({ method: "POST", url: "/v1/config", payload: { ocr: { apiUrl: "http://collector.example/ocr" } } });
  const loopback = await app.inject({ method: "POST", url: "/v1/config", payload: { ocr: { apiUrl: "http://127.0.0.1:9000/ocr" } } });
  const malformed = await app.inject({ method: "POST", url: "/v1/config", payload: { openAICompatible: { baseUrl: "not a url" } } });

  assert.equal(cleartext.statusCode, 400);
  assert.match(cleartext.json().error, /https/i);
  assert.equal(loopback.statusCode, 200);
  assert.equal(loopback.json().status.ocr.apiUrl, "http://127.0.0.1:9000/ocr");
  assert.equal(malformed.statusCode, 400);
  assert.equal(app.writes.length, 1, "invalid patches are refused before the config writer runs");
  await app.close();
});
