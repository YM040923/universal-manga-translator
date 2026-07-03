import type { SurfaceStatus } from "../surface/surface-state.js";
import type { RegisteredSurface } from "../surface/surface-registry.js";

export interface QueueSnapshot {
  total: number;
  queued: number;
  processing: number;
  completed: number;
  cached: number;
  empty: number;
  failed: number;
  cancelled: number;
  paused: boolean;
}

export interface TranslationQueueOptions {
  concurrency: number;
  maxAutoItems?: number;
  stopAfterConsecutiveFailures?: number;
  worker: (surface: RegisteredSurface) => Promise<SurfaceStatus | void>;
  onStatusChange?: (surfaceId: string, status: SurfaceStatus) => void;
}

const TERMINAL_STATUSES = new Set<SurfaceStatus>(["completed", "cached", "empty", "failed", "cancelled"]);
const ACTIVE_STATUSES = new Set<SurfaceStatus>(["fetching", "ocr", "translating", "rendering"]);

export class TranslationQueue {
  private surfaces: RegisteredSurface[] = [];
  private statuses = new Map<string, SurfaceStatus>();
  private paused = false;
  private processing = new Set<string>();
  private generation = 0;
  private autoRun: Promise<void> | null = null;
  private followUpAutoRunRequested = false;

  constructor(private readonly options: TranslationQueueOptions) {}

  setSurfaces(surfaces: RegisteredSurface[]): void {
    this.surfaces = [...surfaces].sort((a, b) => a.index - b.index);
    for (const surface of this.surfaces) {
      if (!this.statuses.has(surface.surfaceId)) this.mark(surface.surfaceId, "idle");
    }
  }

  mark(surfaceId: string, status: SurfaceStatus): boolean {
    const previous = this.statuses.get(surfaceId);
    if (previous && TERMINAL_STATUSES.has(previous) && !TERMINAL_STATUSES.has(status) && status !== "idle") return false;
    this.statuses.set(surfaceId, status);
    this.options.onStatusChange?.(surfaceId, status);
    return true;
  }

  getStatus(surfaceId: string): SurfaceStatus {
    return this.statuses.get(surfaceId) ?? "idle";
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  clear(_reason: string): void {
    this.generation += 1;
    this.autoRun = null;
    this.surfaces = [];
    this.statuses.clear();
    this.processing.clear();
    this.paused = false;
  }

  async startAuto(): Promise<void> {
    if (this.autoRun) {
      this.followUpAutoRunRequested = true;
      return this.autoRun;
    }
    const run = this.runAutoLoop();
    this.autoRun = run;
    try {
      await run;
    } finally {
      if (this.autoRun === run) this.autoRun = null;
    }
  }

  private async runAutoLoop(): Promise<void> {
    do {
      this.followUpAutoRunRequested = false;
      await this.runAuto();
    } while (this.followUpAutoRunRequested && !this.paused);
  }

  private async runAuto(): Promise<void> {
    if (this.paused) return;
    const generation = this.generation;
    const maxItems = Math.max(1, Math.trunc(this.options.maxAutoItems ?? Number.POSITIVE_INFINITY));
    const pending = this.surfaces.filter((surface) => !TERMINAL_STATUSES.has(this.getStatus(surface.surfaceId))).slice(0, maxItems);
    for (const surface of pending) this.mark(surface.surfaceId, "queued");
    if (!pending.length) return;
    const [first, ...rest] = pending;
    if (first) await this.runPending([first], generation, 1);
    if (!this.paused && generation === this.generation && rest.length) await this.runPending(rest, generation);
  }

  snapshot(): QueueSnapshot {
    let queued = 0;
    let completed = 0;
    let cached = 0;
    let empty = 0;
    let failed = 0;
    let cancelled = 0;
    const processingIds = new Set(this.processing);
    for (const surface of this.surfaces) {
      const status = this.getStatus(surface.surfaceId);
      if (status === "queued") queued += 1;
      if (status === "completed") completed += 1;
      if (status === "cached") cached += 1;
      if (status === "empty") empty += 1;
      if (status === "failed") failed += 1;
      if (status === "cancelled") cancelled += 1;
      if (ACTIVE_STATUSES.has(status)) processingIds.add(surface.surfaceId);
    }
    return { total: this.surfaces.length, queued, processing: processingIds.size, completed, cached, empty, failed, cancelled, paused: this.paused };
  }

  private async runPending(pending: RegisteredSurface[], generation: number, concurrencyOverride?: number): Promise<void> {
    const concurrency = concurrencyOverride ?? Math.max(1, Math.min(4, Math.trunc(this.options.concurrency)));
    let cursor = 0;
    const runNext = async (): Promise<void> => {
      while (!this.paused && cursor < pending.length) {
        const surface = pending[cursor++];
        if (!surface || TERMINAL_STATUSES.has(this.getStatus(surface.surfaceId))) continue;
        if (generation !== this.generation) return;
        this.processing.add(surface.surfaceId);
        this.mark(surface.surfaceId, "translating");
        try {
          const resultStatus = await this.options.worker(surface);
          this.processing.delete(surface.surfaceId);
          if (generation === this.generation) this.mark(surface.surfaceId, resultStatus ?? "completed");
          if (generation === this.generation && this.shouldPauseAfterFailures()) {
            this.pauseForFailureLimit();
            return;
          }
        } catch {
          this.processing.delete(surface.surfaceId);
          if (generation === this.generation) this.mark(surface.surfaceId, "failed");
          if (generation === this.generation && this.shouldPauseAfterFailures()) {
            this.pauseForFailureLimit();
            return;
          }
        } finally {
          this.processing.delete(surface.surfaceId);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => runNext()));
  }

  private shouldPauseAfterFailures(): boolean {
    const limit = Math.trunc(this.options.stopAfterConsecutiveFailures ?? 0);
    if (limit <= 0) return false;
    const terminal = this.surfaces.filter((surface) => TERMINAL_STATUSES.has(this.getStatus(surface.surfaceId)));
    let consecutiveFailures = 0;
    for (let index = terminal.length - 1; index >= 0; index -= 1) {
      const status = this.getStatus(terminal[index]!.surfaceId);
      if (status !== "failed") break;
      consecutiveFailures += 1;
      if (consecutiveFailures >= limit) return true;
    }
    return false;
  }

  private pauseForFailureLimit(): void {
    this.paused = true;
    for (const surface of this.surfaces) {
      if (this.getStatus(surface.surfaceId) === "queued") this.mark(surface.surfaceId, "idle");
    }
  }
}
