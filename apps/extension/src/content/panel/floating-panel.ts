export type FloatingPanelState = "idle" | "busy" | "done" | "paused" | "offline" | "error";

export interface FloatingPanelActions {
  onTranslateCurrent: () => void;
  onSelectRegion?: () => void;
}

export class FloatingPanel {
  readonly root: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly status: HTMLSpanElement;

  constructor(actions: FloatingPanelActions) {
    this.root = document.createElement("div");
    this.root.dataset.umtPanel = "true";
    this.root.dataset.state = "idle";
    this.root.style.cssText = "position:fixed;right:18px;bottom:92px;z-index:2147483647;font:13px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";

    this.button = document.createElement("button");
    this.button.dataset.umtFloatingButton = "true";
    this.button.type = "button";
    this.button.style.cssText = "display:flex;align-items:center;gap:8px;border:1px solid rgba(255,122,26,.35);border-radius:999px;background:linear-gradient(135deg,#ff7a1a,#ff4d00);color:#fff;padding:10px 14px;box-shadow:0 10px 26px rgba(255,96,20,.28);cursor:pointer;font-weight:800;letter-spacing:.02em;";
    this.button.addEventListener("click", actions.onTranslateCurrent);

    const icon = document.createElement("span");
    icon.textContent = "\u6f2b";
    icon.style.cssText = "display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.2);font-weight:900;";

    this.status = document.createElement("span");
    this.status.dataset.umtStatus = "true";
    this.status.textContent = "\u7ffb\u8bd1";

    this.button.append(icon, this.status);
    this.root.append(this.button);
    if (actions.onSelectRegion) {
      const selectButton = document.createElement("button");
      selectButton.dataset.umtSelectButton = "true";
      selectButton.type = "button";
      selectButton.textContent = "框选";
      selectButton.title = "框选区域翻译";
      selectButton.style.cssText = "margin-top:7px;display:block;width:100%;border:1px solid rgba(255,122,26,.35);border-radius:999px;background:#fff7ed;color:#c2410c;padding:7px 10px;box-shadow:0 6px 18px rgba(255,96,20,.14);cursor:pointer;font-weight:800;";
      selectButton.addEventListener("click", actions.onSelectRegion);
      this.root.append(selectButton);
    }
  }

  mount(): void {
    if (!document.documentElement.contains(this.root)) document.documentElement.append(this.root);
  }

  setStatus(text: string, state: FloatingPanelState = "idle"): void {
    this.status.textContent = text;
    this.root.dataset.state = state;
    if (state === "offline" || state === "error") {
      this.button.style.background = "linear-gradient(135deg,#64748b,#334155)";
      this.button.style.boxShadow = "0 10px 26px rgba(51,65,85,.22)";
    } else if (state === "busy") {
      this.button.style.background = "linear-gradient(135deg,#2563eb,#4f46e5)";
      this.button.style.boxShadow = "0 10px 26px rgba(37,99,235,.24)";
    } else if (state === "done") {
      this.button.style.background = "linear-gradient(135deg,#16a34a,#15803d)";
      this.button.style.boxShadow = "0 10px 26px rgba(22,163,74,.24)";
    } else if (state === "paused") {
      this.button.style.background = "linear-gradient(135deg,#f59e0b,#d97706)";
      this.button.style.boxShadow = "0 10px 26px rgba(217,119,6,.22)";
    } else {
      this.button.style.background = "linear-gradient(135deg,#ff7a1a,#ff4d00)";
      this.button.style.boxShadow = "0 10px 26px rgba(255,96,20,.28)";
    }
  }

  setEnabled(enabled: boolean): void {
    this.root.style.display = enabled ? "" : "none";
  }
}
