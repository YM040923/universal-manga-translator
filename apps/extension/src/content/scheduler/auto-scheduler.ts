export class AutoScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private running = false;
  private pendingReason: string | null = null;

  constructor(private readonly run: (reason: string) => void | Promise<void>, private readonly delayMs = 350) {}

  requestRun(reason: string): void {
    if (this.paused) return;
    if (this.running) {
      this.pendingReason = reason;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runOnce(reason);
    }, this.delayMs);
  }

  pause(): void {
    this.paused = true;
    this.pendingReason = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  private async runOnce(reason: string): Promise<void> {
    if (this.paused || this.running) return;
    this.running = true;
    try {
      await this.run(reason);
    } finally {
      this.running = false;
      const pending = this.pendingReason;
      this.pendingReason = null;
      if (pending && !this.paused) this.requestRun(pending);
    }
  }
}
