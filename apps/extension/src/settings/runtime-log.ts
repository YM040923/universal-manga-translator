export type RuntimeLogLevel = "info" | "warn" | "error";
export type RuntimeLogSource = "popup" | "content" | "backend";

export interface RuntimeLogEntry {
  ts: number;
  level: RuntimeLogLevel;
  source: RuntimeLogSource;
  message: string;
  detail?: string;
}

export interface RuntimeLogInput {
  level: RuntimeLogLevel;
  source: RuntimeLogSource;
  message: string;
  detail?: string;
}

export interface RuntimeLogStorage {
  get(keys?: unknown): Promise<Record<string, unknown>> | void;
  set(value: Record<string, unknown>): Promise<void> | void;
}

const RUNTIME_LOGS_KEY = "runtimeLogs";
const MAX_LOGS = 100;

export async function readRuntimeLogs(storage: RuntimeLogStorage = chrome.storage.local): Promise<RuntimeLogEntry[]> {
  const saved = await storage.get([RUNTIME_LOGS_KEY]);
  const raw = saved?.[RUNTIME_LOGS_KEY];
  return Array.isArray(raw) ? raw.filter(isRuntimeLogEntry).slice(0, MAX_LOGS) : [];
}

export async function appendRuntimeLog(input: RuntimeLogInput, storage: RuntimeLogStorage = chrome.storage.local): Promise<RuntimeLogEntry> {
  const entry: RuntimeLogEntry = {
    ts: Date.now(),
    level: input.level,
    source: input.source,
    message: input.message,
    ...(input.detail ? { detail: input.detail.slice(0, 2000) } : {}),
  };
  const logs = await readRuntimeLogs(storage);
  await storage.set({ [RUNTIME_LOGS_KEY]: [entry, ...logs].slice(0, MAX_LOGS) });
  return entry;
}

export async function clearRuntimeLogs(storage: RuntimeLogStorage = chrome.storage.local): Promise<void> {
  await storage.set({ [RUNTIME_LOGS_KEY]: [] });
}

export function formatRuntimeLogs(logs: RuntimeLogEntry[]): string {
  if (!logs.length) return "暂无运行日志";
  return logs.map((log) => {
    const time = new Date(log.ts).toLocaleTimeString();
    return `${time} | ${log.level.toUpperCase()} | ${log.source} | ${log.message}${log.detail ? ` | ${log.detail}` : ""}`;
  }).join("\n");
}

function isRuntimeLogEntry(value: unknown): value is RuntimeLogEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<RuntimeLogEntry>;
  return typeof candidate.ts === "number"
    && (candidate.level === "info" || candidate.level === "warn" || candidate.level === "error")
    && (candidate.source === "popup" || candidate.source === "content" || candidate.source === "backend")
    && typeof candidate.message === "string";
}
