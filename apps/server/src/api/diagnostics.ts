import { appendFileSync, mkdirSync } from "node:fs";
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
