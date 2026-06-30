import type { ServerEvent } from "@umt/shared/protocol";

export interface TranslationStatusSnapshot {
  queued: number;
  processing: number;
  done: number;
  failed: number;
}

export class TranslationStatusCounter {
  private queued = 0;
  private done = 0;
  private failed = 0;
  private readonly queuedSurfaces = new Set<string>();
  private readonly processingSurfaces = new Set<string>();
  private readonly terminalSurfaces = new Set<string>();

  recordEvent(event: ServerEvent): TranslationStatusSnapshot {
    if (event.type === "job.queued") this.recordQueued(event.surfaceId);
    if (event.type === "job.processing") this.recordProcessing(event.surfaceId);
    if (event.type === "job.completed" || event.type === "job.cached") this.recordDone(event.surfaceId);
    if (event.type === "job.failed") this.recordFailed(event.surfaceId);
    return this.snapshot();
  }

  recordFailedResponse(surfaceId: string): TranslationStatusSnapshot {
    this.recordFailed(surfaceId);
    return this.snapshot();
  }

  snapshot(): TranslationStatusSnapshot {
    return { queued: this.queued, processing: this.processingSurfaces.size, done: this.done, failed: this.failed };
  }

  format(): string {
    const snapshot = this.snapshot();
    return `UMT: queued ${snapshot.queued} | processing ${snapshot.processing} | done ${snapshot.done} | failed ${snapshot.failed}`;
  }

  private recordQueued(surfaceId: string): void {
    if (this.queuedSurfaces.has(surfaceId)) return;
    this.queuedSurfaces.add(surfaceId);
    this.queued += 1;
  }

  private recordProcessing(surfaceId: string): void {
    if (this.terminalSurfaces.has(surfaceId)) return;
    this.processingSurfaces.add(surfaceId);
  }

  private recordDone(surfaceId: string): void {
    if (this.terminalSurfaces.has(surfaceId)) return;
    this.terminalSurfaces.add(surfaceId);
    this.processingSurfaces.delete(surfaceId);
    this.done += 1;
  }

  private recordFailed(surfaceId: string): void {
    if (this.terminalSurfaces.has(surfaceId)) return;
    this.terminalSurfaces.add(surfaceId);
    this.processingSurfaces.delete(surfaceId);
    this.failed += 1;
  }
}