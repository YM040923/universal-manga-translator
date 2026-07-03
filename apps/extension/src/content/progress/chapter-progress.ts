import type { QueueSnapshot } from "../queue/translation-queue.js";

export interface ChapterProgressOptions {
  storageKey?: string;
}

const DEFAULT_STORAGE_KEY = "umt.chapterProgress.position";

export class ChapterProgress {
  readonly root: HTMLDivElement;
  private readonly storageKey: string;
  private body: HTMLDivElement;
  private bar: HTMLDivElement;
  private title: HTMLSpanElement;
  private folded = false;
  private dragging: { startX: number; startY: number; left: number; top: number } | null = null;

  constructor(options: ChapterProgressOptions = {}) {
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.root = document.createElement("div");
    this.root.dataset.umtChapterProgress = "true";
    this.root.style.cssText = [
      "position:fixed",
      "left:18px",
      "top:80px",
      "z-index:2147483645",
      "min-width:172px",
      "border-radius:14px",
      "background:rgba(15,23,42,.86)",
      "color:#fff",
      "box-shadow:0 10px 28px rgba(15,23,42,.28)",
      "font:12px/1.45 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "opacity:.55",
      "transition:opacity .12s ease",
      "overflow:hidden",
      "user-select:none",
      "pointer-events:auto",
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;cursor:grab;font-weight:900";
    this.title = document.createElement("span");
    this.title.dataset.umtProgressTitle = "true";
    this.title.textContent = "翻译进度";
    const fold = document.createElement("button");
    fold.type = "button";
    fold.dataset.action = "toggle-fold";
    fold.textContent = "–";
    fold.style.cssText = "border:0;border-radius:999px;background:rgba(255,255,255,.16);color:#fff;width:22px;height:22px;cursor:pointer";
    header.append(this.title, fold);

    const track = document.createElement("div");
    track.dataset.umtProgressTrack = "true";
    track.style.cssText = "height:6px;margin:0 10px 8px;border-radius:999px;background:rgba(255,255,255,.16);overflow:hidden";
    this.bar = document.createElement("div");
    this.bar.dataset.umtProgressBar = "true";
    this.bar.style.cssText = "height:100%;width:0%;border-radius:999px;background:#38bdf8;transition:width .16s ease,background .16s ease";
    track.append(this.bar);

    this.body = document.createElement("div");
    this.body.dataset.umtProgressBody = "true";
    this.body.style.cssText = "padding:0 10px 10px;white-space:pre-wrap";
    this.body.textContent = "等待扫描";

    this.root.append(header, track, this.body);
    this.root.addEventListener("mouseenter", () => { this.root.style.opacity = "0.96"; });
    this.root.addEventListener("mouseleave", () => { this.root.style.opacity = "0.55"; });
    fold.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setFolded(!this.folded);
    });
    header.addEventListener("mousedown", (event) => this.startDrag(event));
    this.root.addEventListener("mousedown", (event) => {
      if (event.target === this.root) this.startDrag(event);
    });
  }

  async mount(): Promise<void> {
    await this.restorePosition();
    if (!document.documentElement.contains(this.root)) document.documentElement.append(this.root);
  }

  remove(): void {
    this.root.remove();
  }

  update(snapshot: QueueSnapshot): void {
    const done = terminalCount(snapshot);
    const pct = snapshot.total ? Math.round((done / snapshot.total) * 100) : 0;
    const state = progressState(snapshot);
    this.root.dataset.progressState = state;
    this.title.textContent = progressTitle(snapshot, pct, state);
    this.bar.style.width = `${pct}%`;
    this.bar.style.background = progressColor(state);
    this.body.textContent = [
      `总计 ${snapshot.total} | ${pct}%`,
      `完成 ${snapshot.completed}  缓存 ${snapshot.cached}`,
      `处理中 ${snapshot.processing}  排队 ${snapshot.queued}`,
      `空 ${snapshot.empty}  失败 ${snapshot.failed}  取消 ${snapshot.cancelled}`,
      progressStage(snapshot, state),
    ].join("\n");
  }

  reset(message = "等待扫描"): void {
    this.root.dataset.progressState = "idle";
    this.title.textContent = "翻译进度";
    this.bar.style.width = "0%";
    this.bar.style.background = progressColor("idle");
    this.body.textContent = message;
  }

  private setFolded(folded: boolean): void {
    this.folded = folded;
    this.root.dataset.folded = String(folded);
    this.body.style.display = folded ? "none" : "block";
    this.root.style.minWidth = folded ? "42px" : "172px";
    const button = this.root.querySelector<HTMLButtonElement>("[data-action='toggle-fold']");
    if (button) button.textContent = folded ? "+" : "–";
  }

  private startDrag(event: MouseEvent): void {
    if (event.button !== 0) return;
    const rect = this.root.getBoundingClientRect();
    const currentLeft = Number.parseFloat(this.root.style.left || "0");
    const currentTop = Number.parseFloat(this.root.style.top || "0");
    this.dragging = { startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top };
    if (rect.left === 0 && Number.isFinite(currentLeft)) this.dragging.left = currentLeft;
    if (rect.top === 0 && Number.isFinite(currentTop)) this.dragging.top = currentTop;
    window.addEventListener("mousemove", this.onDrag);
    window.addEventListener("mouseup", this.stopDrag, { once: true });
  }

  private readonly onDrag = (event: MouseEvent): void => {
    if (!this.dragging) return;
    const left = Math.max(0, Math.round(this.dragging.left + event.clientX - this.dragging.startX));
    const top = Math.max(0, Math.round(this.dragging.top + event.clientY - this.dragging.startY));
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
    this.root.style.right = "auto";
  };

  private readonly stopDrag = (): void => {
    window.removeEventListener("mousemove", this.onDrag);
    this.dragging = null;
    void this.persistPosition();
  };

  private async restorePosition(): Promise<void> {
    try {
      const result = await chrome.storage?.local?.get?.(this.storageKey);
      const pos = result?.[this.storageKey] as { left?: number; top?: number } | undefined;
      if (typeof pos?.left === "number" && typeof pos.top === "number") {
        this.root.style.left = `${Math.max(0, Math.round(pos.left))}px`;
        this.root.style.top = `${Math.max(0, Math.round(pos.top))}px`;
      }
    } catch {
      // Position persistence is best-effort.
    }
  }

  private async persistPosition(): Promise<void> {
    try {
      await chrome.storage?.local?.set?.({
        [this.storageKey]: {
          left: Number.parseFloat(this.root.style.left || "0"),
          top: Number.parseFloat(this.root.style.top || "0"),
        },
      });
    } catch {
      // Position persistence is best-effort.
    }
  }
}

type ProgressState = "idle" | "running" | "paused" | "done" | "failed" | "cancelled";

function terminalCount(snapshot: QueueSnapshot): number {
  return snapshot.completed + snapshot.cached + snapshot.empty + snapshot.failed + snapshot.cancelled;
}

function progressState(snapshot: QueueSnapshot): ProgressState {
  if (!snapshot.total) return "idle";
  if (snapshot.paused) return "paused";
  const done = terminalCount(snapshot);
  if (done >= snapshot.total) {
    if (snapshot.failed > 0) return "failed";
    if (snapshot.cancelled > 0) return "cancelled";
    return "done";
  }
  return "running";
}

function progressTitle(snapshot: QueueSnapshot, pct: number, state: ProgressState): string {
  if (state === "idle") return "翻译进度";
  if (state === "paused") return `已暂停 ${pct}%`;
  if (state === "done") return "翻译完成";
  if (state === "failed") return `有失败 ${pct}%`;
  if (state === "cancelled") return `已取消 ${pct}%`;
  return progressStage(snapshot, state);
}

function progressStage(snapshot: QueueSnapshot, state: ProgressState): string {
  if (state === "idle") return "等待开始";
  if (state === "paused") return "已暂停";
  if (state === "done") return "已完成";
  if (state === "failed") return "完成但有失败";
  if (state === "cancelled") return "已取消";
  if (snapshot.processing > 0) return "处理中";
  if (snapshot.queued > 0) return "排队中";
  return "运行中";
}

function progressColor(state: ProgressState): string {
  if (state === "done") return "#22c55e";
  if (state === "failed") return "#ef4444";
  if (state === "cancelled") return "#94a3b8";
  if (state === "paused") return "#f59e0b";
  if (state === "running") return "#38bdf8";
  return "#64748b";
}
