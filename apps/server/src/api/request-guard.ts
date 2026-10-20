import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { isAllowedRequestOrigin, isAllowedServerHost } from "./origin-policy.js";

const EVENT_SESSION_PATH = "/v1/events";
const EVENT_SESSION_PARAM = "sessionId";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Configuration writes hand the backend new API endpoints and secrets, so they
 * are limited to local non-browser clients (the desktop shell's main process).
 * Browser contexts may still read status and submit translation jobs.
 */
const LOCAL_ONLY_PREFIXES = ["/v1/config"];

export interface EventSessionGate {
  create(): string;
  accept(sessionId: string | undefined): boolean;
}

/**
 * The WebSocket handshake is not covered by CORS, so any webpage could otherwise
 * open /v1/events and read the user's translation results as they stream in.
 * A page cannot read responses from the CORS-guarded POST /v1/session, so only
 * a permitted client can learn a session id and use it to subscribe.
 */
export function createEventSessionGate(options: { maxSessions?: number; ttlMs?: number } = {}): EventSessionGate {
  const maxSessions = options.maxSessions ?? 128;
  const ttlMs = options.ttlMs ?? 60 * 60 * 1000;
  const expiryBySession = new Map<string, number>();
  return {
    create() {
      const now = Date.now();
      for (const [sessionId, expiresAt] of expiryBySession) {
        if (expiresAt <= now) expiryBySession.delete(sessionId);
      }
      while (expiryBySession.size >= maxSessions) {
        const oldest = expiryBySession.keys().next().value;
        if (oldest === undefined) break;
        expiryBySession.delete(oldest);
      }
      const sessionId = randomUUID();
      expiryBySession.set(sessionId, now + ttlMs);
      return sessionId;
    },
    accept(sessionId) {
      if (!sessionId) return false;
      const expiresAt = expiryBySession.get(sessionId);
      if (expiresAt === undefined) return false;
      if (expiresAt <= Date.now()) {
        expiryBySession.delete(sessionId);
        return false;
      }
      return true;
    },
  };
}

export function requestPath(url: string): string {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

export function eventSessionIdFromUrl(url: string): string | undefined {
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return undefined;
  return new URLSearchParams(url.slice(queryIndex + 1)).get(EVENT_SESSION_PARAM) ?? undefined;
}

function hasJsonContentType(request: FastifyRequest): boolean {
  const header = request.headers["content-type"];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value.toLowerCase().includes("application/json");
}

function isLocalOnlyRoute(url: string, method: string): boolean {
  return method.toUpperCase() === "POST" && LOCAL_ONLY_PREFIXES.some((prefix) => requestPath(url).startsWith(prefix));
}

export function createRequestGuard(gate: EventSessionGate) {
  return async function guardRequestOriginPolicy(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!isAllowedServerHost(request.headers.host)) {
      reply.code(403).type("application/json").send({ ok: false, error: "Backend requests must use a loopback Host header." });
      return;
    }
    if (requestPath(request.url) === EVENT_SESSION_PATH) {
      if (gate.accept(eventSessionIdFromUrl(request.url))) return;
      reply.code(403).type("application/json").send({ ok: false, error: "Event stream requires a sessionId issued by POST /v1/session." });
      return;
    }
    const origin = request.headers.origin;
    if (!isAllowedRequestOrigin(origin)) {
      reply.code(403).type("application/json").send({ ok: false, error: "Request origin is not allowed by the local backend policy." });
      return;
    }
    if (isLocalOnlyRoute(request.url, request.method) && origin !== undefined) {
      reply.code(403).type("application/json").send({ ok: false, error: "Backend configuration can only be changed by a local process, not from a browser page." });
      return;
    }
    if (MUTATING_METHODS.has(request.method.toUpperCase()) && requestPath(request.url).startsWith("/v1") && !hasJsonContentType(request)) {
      reply.code(415).type("application/json").send({ ok: false, error: "Backend requests must send content-type: application/json." });
    }
  };
}
