export interface FloatingPanelActions {
  onTranslateCurrent: () => void;
  onRescan: () => void;
  onToggleOverlays: () => void;
  onTogglePause: () => void;
}

export class FloatingPanel {
  readonly root: HTMLDivElement;
  private readonly status: HTMLDivElement;

  constructor(actions: FloatingPanelActions) {
    this.root = document.createElement("div");
    this.root.dataset.umtPanel = "true";
    this.root.style.cssText = "position:fixed;right:16px;top:96px;z-index:2147483647;background:#111827;color:white;padding:10px;border-radius:12px;font:12px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.25);display:grid;gap:6px;";
    this.status = document.createElement("div");
    this.status.textContent = "UMT: connecting";
    this.root.append(
      this.status,
      this.button("翻译当前屏", actions.onTranslateCurrent),
      this.button("重新扫描", actions.onRescan),
      this.button("暂停/继续", actions.onTogglePause),
      this.button("隐藏/显示", actions.onToggleOverlays),
    );
  }

  mount(): void {
    if (!document.documentElement.contains(this.root)) document.documentElement.append(this.root);
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText = "border:0;border-radius:8px;padding:6px 8px;cursor:pointer;";
    button.addEventListener("click", onClick);
    return button;
  }
}
