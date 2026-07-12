import { appendRuntimeLog } from "../settings/runtime-log";
import { formatShortError } from "./utils";

export interface ContentLogger {
  info(message: string, detail?: string): void;
  warn(message: string, detail?: string): void;
  error(message: string, error: unknown): void;
}

export function createContentLogger(): ContentLogger {
  return {
    info(message, detail) {
      void appendRuntimeLog({ level: "info", source: "content", message, ...(detail ? { detail } : {}) });
    },
    warn(message, detail) {
      void appendRuntimeLog({ level: "warn", source: "content", message, ...(detail ? { detail } : {}) });
    },
    error(message, error) {
      void appendRuntimeLog({ level: "error", source: "content", message, detail: formatShortError(error) });
    },
  };
}
