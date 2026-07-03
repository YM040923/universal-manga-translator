import { surfaceStatusView, type SurfaceStatus } from "./surface-state.js";

export interface SurfaceControlOptions {
  surfaceId: string;
  image: HTMLElement;
  index: number;
  onAction: (surfaceId: string) => void;
}

export interface SurfaceControlStatusOptions {
  queueIndex?: number;
  detail?: string;
}

export class SurfaceControl {
  readonly button: HTMLButtonElement;
  private readonly surfaceId: string;
  private readonly image: HTMLElement;
  private index: number;
  private readonly onAction: (surfaceId: string) => void;

  constructor(options: SurfaceControlOptions) {
    this.surfaceId = options.surfaceId;
    this.image = options.image;
    this.index = options.index;
    this.onAction = options.onAction;
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.dataset.umtSurfaceButton = this.surfaceId;
    this.button.dataset.umtSurfaceIndex = String(this.index);
    this.button.style.cssText = [
      "position:absolute",
      "z-index:2147483645",
      "border:0",
      "border-radius:999px",
      "color:#fff",
      "padding:5px 9px",
      "font:12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "font-weight:800",
      "box-shadow:0 6px 16px rgba(15,23,42,.18)",
      "cursor:pointer",
      "opacity:.18",
      "transition:opacity .12s ease, transform .12s ease",
      "pointer-events:auto",
    ].join(";");
    this.button.addEventListener("mouseenter", () => { this.button.style.opacity = "0.96"; });
    this.button.addEventListener("mouseleave", () => { this.button.style.opacity = "0.18"; });
    this.image.addEventListener("mouseenter", () => { this.button.style.opacity = "0.78"; });
    this.image.addEventListener("mouseleave", () => { this.button.style.opacity = "0.18"; });
    this.button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onAction(this.surfaceId);
    });
  }

  mount(): void {
    if (!document.documentElement.contains(this.button)) document.documentElement.append(this.button);
    this.refreshPosition();
  }

  remove(): void {
    this.button.remove();
  }

  updateIndex(index: number): void {
    this.index = index;
    this.button.dataset.umtSurfaceIndex = String(this.index);
  }

  setStatus(status: SurfaceStatus, options: SurfaceControlStatusOptions = {}): void {
    const view = surfaceStatusView(status);
    const label = status === "queued" && options.queueIndex ? `${view.label} #${options.queueIndex}` : view.label;
    this.button.textContent = `#${this.index} ${label}`;
    this.button.title = options.detail ? `第 ${this.index} 张：${view.label} | ${options.detail}` : `第 ${this.index} 张：${view.label}`;
    this.button.style.background = view.color;
    this.button.dataset.umtSurfaceStatus = status;
  }

  refreshPosition(): void {
    const rect = this.image.getBoundingClientRect();
    const left = Math.round(rect.left + window.scrollX + 8);
    const top = Math.round(rect.top + window.scrollY + 8);
    this.button.style.left = `${left}px`;
    this.button.style.top = `${top}px`;
  }
}

