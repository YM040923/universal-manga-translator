export class AutoScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;

  constructor(private readonly run: (reason: string) => void | Promise<void>, private readonly delayMs = 350) {}

  requestRun(reason: string): void {
    if (this.paused) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(reason);
    }, this.delayMs);
  }

  pause(): void {
    this.paused = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }
}
