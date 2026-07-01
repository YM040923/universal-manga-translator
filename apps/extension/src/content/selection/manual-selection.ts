import type { Rect } from "@umt/shared/types";

export interface ManualSelectionOptions {
  onSelect: (rect: Rect) => void;
  onCancel?: () => void;
  minSize?: number;
}

export class ManualSelectionController {
  private layer: HTMLDivElement | null = null;
  private box: HTMLDivElement | null = null;
  private startPoint: { x: number; y: number } | null = null;

  constructor(private readonly options: ManualSelectionOptions) {}

  start(): void {
    this.cancel();
    const layer = document.createElement("div");
    layer.dataset.umtSelectionLayer = "true";
    layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(15,23,42,.08);";

    const hint = document.createElement("div");
    hint.textContent = "拖拽选择要翻译的漫画区域，Esc 取消";
    hint.style.cssText = "position:fixed;left:50%;top:18px;transform:translateX(-50%);background:#111827;color:#fff;border-radius:999px;padding:9px 14px;font:13px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.22);";
    layer.append(hint);

    layer.addEventListener("mousedown", (event) => this.begin(event));
    layer.addEventListener("mousemove", (event) => this.move(event));
    layer.addEventListener("mouseup", (event) => this.end(event));
    document.addEventListener("keydown", this.onKeyDown);
    document.documentElement.append(layer);
    this.layer = layer;
  }

  cancel(): void {
    this.layer?.remove();
    this.layer = null;
    this.box = null;
    this.startPoint = null;
    document.removeEventListener("keydown", this.onKeyDown);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      this.cancel();
      this.options.onCancel?.();
    }
  };

  private begin(event: MouseEvent): void {
    if (!this.layer) return;
    this.startPoint = { x: event.clientX, y: event.clientY };
    const box = document.createElement("div");
    box.dataset.umtSelectionBox = "true";
    box.style.cssText = "position:fixed;border:2px solid #ff6a1a;background:rgba(255,106,26,.16);box-shadow:0 0 0 9999px rgba(15,23,42,.18);pointer-events:none;";
    this.layer.append(box);
    this.box = box;
    this.updateBox(event.clientX, event.clientY);
  }

  private move(event: MouseEvent): void {
    if (!this.startPoint || !this.box) return;
    this.updateBox(event.clientX, event.clientY);
  }

  private end(event: MouseEvent): void {
    if (!this.startPoint) return;
    const rect = this.rectFromPoints(this.startPoint.x, this.startPoint.y, event.clientX, event.clientY);
    const minSize = this.options.minSize ?? 12;
    this.cancel();
    if (rect.width >= minSize && rect.height >= minSize) this.options.onSelect(rect);
  }

  private updateBox(x: number, y: number): void {
    if (!this.startPoint || !this.box) return;
    const rect = this.rectFromPoints(this.startPoint.x, this.startPoint.y, x, y);
    Object.assign(this.box.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  private rectFromPoints(x1: number, y1: number, x2: number, y2: number): Rect {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }
}
