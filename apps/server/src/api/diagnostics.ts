import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, truncateSync } from "node:fs";
import { dirname } from "node:path";
import type { JobStatus, Size } from "@umt/shared";

export interface SubmitDiagnosticsRecord {
  surfaceId: string;
  status: JobStatus | "cached";
  providerProfile: string;
  inputSource: "imageData" | "imageUrl";
  originalSize: Size;
  providerSize: Size;
  rawRegionCount: number;
  finalRegionCount: number;
  filteredRegionCount?: number;
  elapsedMs: number;
  note?: string;
}

export interface DiagnosticsWriter {
  record(record: SubmitDiagnosticsRecord): void;
}

export class NullDiagnosticsWriter implements DiagnosticsWriter {
  record(): void { /* intentionally empty */ }
}

export class FileDiagnosticsWriter implements DiagnosticsWriter {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  record(record: SubmitDiagnosticsRecord): void {
    const safe = {
      ts: Date.now(),
      surfaceId: record.surfaceId,
      status: record.status,
      providerProfile: record.providerProfile,
      inputSource: record.inputSource,
      originalSize: record.originalSize,
      providerSize: record.providerSize,
      rawRegionCount: record.rawRegionCount,
      finalRegionCount: record.finalRegionCount,
      filteredRegionCount: record.filteredRegionCount,
      elapsedMs: record.elapsedMs,
      note: sanitizeNote(record.note),
    };
    appendFileSync(this.path, `${JSON.stringify(safe)}\n`, "utf8");
  }
}

function sanitizeNote(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, "[redacted-image]")
    .replace(/base64/gi, "[redacted-base64]")
    .slice(0, 300);
}

export function readRecentDiagnostics(path: string, limit = 20): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.slice(-Math.max(1, Math.min(100, Math.trunc(limit)))).reverse().flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      return [parsed];
    } catch {
      return [];
    }
  });
}

export function clearDiagnostics(path: string): number {
  if (!existsSync(path)) return 0;
  const size = statSync(path).size;
  truncateSync(path, 0);
  return size;
}

