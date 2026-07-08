export type FloatingPanelState = "idle" | "busy" | "done" | "paused" | "offline" | "error";

export interface FloatingPanelActions {
  onToggleOverlayVisibility: (visible: boolean) => void;
  onRetranslatePage?: () => void;
  onSelectRegion?: () => void;
}

interface FloatingPanelPosition {
  left: number;
  top: number;
}

const POSITION_KEY = "umtFloatingPanelPosition";
const PANEL_WIDTH = 42;
const PANEL_HEIGHT = 42;
const VIEWPORT_MARGIN = 8;
const DRAG_THRESHOLD_PX = 4;

export class FloatingPanel {
  readonly root: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly status: HTMLSpanElement;
  private readonly icon: HTMLSpanElement;
  private readonly eyeIcon: HTMLSpanElement;
  private readonly menu: HTMLDivElement | null = null;
  private overlayVisible = true;
  private dragStart: { pointerX: number; pointerY: number; left: number; top: number } | null = null;
  private dragMoved = false;
  private suppressNextClick = false;

  constructor(actions: FloatingPanelActions) {
    this.root = document.createElement("div");
    this.root.dataset.umtPanel = "true";
    this.root.dataset.state = "idle";
    this.root.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:92px",
      "z-index:2147483647",
      "display:flex",
      "flex-direction:column",
      "align-items:flex-end",
      "gap:6px",
      "font:12px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "user-select:none",
    ].join(";");

    this.button = document.createElement("button");
    this.button.dataset.umtFloatingButton = "true";
    this.button.type = "button";
    this.button.style.cssText = [
      "position:relative",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "width:42px",
      "height:42px",
      "border:1px solid rgba(255,122,26,.36)",
      "border-radius:999px",
      "background:linear-gradient(135deg,#ff7a1a,#ff4d00)",
      "color:#fff",
      "padding:0",
      "box-shadow:0 10px 26px rgba(255,96,20,.26), inset 0 1px 0 rgba(255,255,255,.28)",
      "cursor:grab",
      "font-weight:900",
      "overflow:hidden",
      "opacity:.72",
      "filter:none",
      "transition:opacity .15s ease,transform .15s ease,box-shadow .15s ease,filter .15s ease",
    ].join(";");
    this.button.addEventListener("mouseenter", () => {
      this.button.style.opacity = "1";
      this.button.style.transform = "translateY(-1px) scale(1.03)";
    });
    this.button.addEventListener("mouseleave", () => {
      this.button.style.opacity = ".72";
      this.button.style.transform = "none";
    });
    this.button.addEventListener("click", (event) => {
      if (this.suppressNextClick) {
        event.preventDefault();
        event.stopPropagation();
        this.suppressNextClick = false;
        return;
      }
      actions.onToggleOverlayVisibility(!this.overlayVisible);
    });
    this.button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleMenu();
    });
    this.button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.beginDrag(event);
    });

    this.icon = document.createElement("span");
    this.icon.dataset.umtFloatingIcon = "true";
    this.icon.style.cssText = [
      "position:relative",
      "display:grid",
      "place-items:center",
      "width:28px",
      "height:28px",
      "border-radius:50%",
      "background:rgba(255,255,255,.18)",
      "font-weight:900",
      "line-height:1",
      "box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)",
    ].join(";");

    this.eyeIcon = document.createElement("span");
    this.eyeIcon.dataset.umtEyeIcon = "true";
    this.eyeIcon.style.cssText = "font-size:16px;line-height:1;transform:translateY(-1px);";

    this.icon.append(this.eyeIcon);

    this.status = document.createElement("span");
    this.status.dataset.umtStatus = "true";
    this.status.textContent = "翻译";
    this.status.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;";

    this.button.append(this.icon, this.status);
    this.root.append(this.button);

    if (actions.onRetranslatePage || actions.onSelectRegion) {
      this.menu = document.createElement("div");
      this.menu.dataset.umtFloatingMenu = "true";
      this.menu.style.cssText = [
        "display:none",
        "flex-direction:column",
        "gap:6px",
        "padding:6px",
        "border:1px solid rgba(15,23,42,.10)",
        "border-radius:14px",
        "background:rgba(255,255,255,.96)",
        "box-shadow:0 10px 26px rgba(15,23,42,.18)",
        "backdrop-filter:blur(8px)",
      ].join(";");
      if (actions.onRetranslatePage) {
        this.menu.append(createMenuButton("重翻本页", "重新翻译当前页面/章节", "umtRetranslateButton", () => {
          actions.onRetranslatePage?.();
          this.closeMenu();
        }));
      }
      if (actions.onSelectRegion) {
        this.menu.append(createMenuButton("框选翻译", "手动框选一块区域翻译", "umtSelectButton", () => {
          actions.onSelectRegion?.();
          this.closeMenu();
        }));
      }
      this.root.append(this.menu);
    }
    this.setOverlayVisible(true);
  }

  mount(): void {
    if (!document.documentElement.contains(this.root)) document.documentElement.append(this.root);
    void this.restorePosition();
  }

  setStatus(text: string, state: FloatingPanelState = "idle"): void {
    this.status.textContent = compactStatusText(text, state);
    this.button.title = text;
    this.root.dataset.state = state;
    if (state === "offline" || state === "error") {
      this.button.style.background = "linear-gradient(135deg,#64748b,#334155)";
      this.button.style.boxShadow = "0 8px 20px rgba(51,65,85,.20)";
    } else if (state === "busy") {
      this.button.style.background = "linear-gradient(135deg,#2563eb,#4f46e5)";
      this.button.style.boxShadow = "0 8px 20px rgba(37,99,235,.22)";
    } else if (state === "done") {
      this.button.style.background = "linear-gradient(135deg,#16a34a,#15803d)";
      this.button.style.boxShadow = "0 8px 20px rgba(22,163,74,.22)";
    } else if (state === "paused") {
      this.button.style.background = "linear-gradient(135deg,#f59e0b,#d97706)";
      this.button.style.boxShadow = "0 8px 20px rgba(217,119,6,.20)";
    } else {
      this.button.style.background = "linear-gradient(135deg,#ff7a1a,#ff4d00)";
      this.button.style.boxShadow = "0 8px 20px rgba(255,96,20,.22)";
    }
    this.refreshOverlayLabel();
  }

  setEnabled(enabled: boolean): void {
    this.root.style.display = enabled ? "" : "none";
  }

  setOverlayVisible(visible: boolean): void {
    this.overlayVisible = visible;
    this.refreshOverlayLabel();
  }

  private refreshOverlayLabel(): void {
    this.eyeIcon.textContent = this.overlayVisible ? "◉" : "◌";
    this.button.style.filter = this.overlayVisible ? "none" : "grayscale(0.85)";
    const statusTitle = this.button.title;
    if (!statusTitle || statusTitle === "显示翻译气泡" || statusTitle === "隐藏翻译气泡") {
      this.button.title = this.overlayVisible ? "隐藏翻译气泡" : "显示翻译气泡";
    }
    this.button.setAttribute("aria-label", this.overlayVisible ? "隐藏翻译气泡" : "显示翻译气泡");
    this.root.dataset.overlayVisible = this.overlayVisible ? "true" : "false";
  }

  private toggleMenu(): void {
    if (!this.menu) return;
    this.menu.style.display = this.menu.style.display === "none" ? "flex" : "none";
  }

  private closeMenu(): void {
    if (this.menu) this.menu.style.display = "none";
  }

  private beginDrag(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.closeMenu();
    const origin = currentPanelPosition(this.root);
    this.dragStart = { pointerX: event.clientX, pointerY: event.clientY, left: origin.left, top: origin.top };
    this.dragMoved = false;
    const target = event.currentTarget as HTMLElement;
    target.style.cursor = "grabbing";
    target.setPointerCapture?.(event.pointerId);
    document.addEventListener("pointermove", this.onDragMove);
    document.addEventListener("pointerup", this.onDragEnd, { once: true });
  }

  private readonly onDragMove = (event: PointerEvent): void => {
    if (!this.dragStart) return;
    const dx = event.clientX - this.dragStart.pointerX;
    const dy = event.clientY - this.dragStart.pointerY;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) this.dragMoved = true;
    this.applyPosition({
      left: this.dragStart.left + dx,
      top: this.dragStart.top + dy,
    });
  };

  private readonly onDragEnd = (event: PointerEvent): void => {
    document.removeEventListener("pointermove", this.onDragMove);
    this.button.style.cursor = "grab";
    if (this.dragMoved) {
      this.suppressNextClick = true;
      void saveStoredPosition(currentPanelPosition(this.root));
    }
    this.dragStart = null;
    this.dragMoved = false;
    event.preventDefault();
    event.stopPropagation();
  };

  private async restorePosition(): Promise<void> {
    const stored = await loadStoredPosition();
    if (stored) this.applyPosition(stored);
  }

  private applyPosition(position: FloatingPanelPosition): void {
    const next = clampPosition(position);
    this.root.style.left = `${Math.round(next.left)}px`;
    this.root.style.top = `${Math.round(next.top)}px`;
    this.root.style.right = "auto";
    this.root.style.bottom = "auto";
  }
}

function createMenuButton(text: string, title: string, datasetName: "umtRetranslateButton" | "umtSelectButton", onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.dataset[datasetName] = "true";
  button.type = "button";
  button.textContent = text;
  button.title = title;
  button.style.cssText = [
    "display:block",
    "width:76px",
    "height:30px",
    "border:1px solid rgba(255,122,26,.30)",
    "border-radius:999px",
    "background:#fff7ed",
    "color:#9a3412",
    "padding:0 8px",
    "box-shadow:0 5px 14px rgba(255,96,20,.10)",
    "cursor:pointer",
    "font-weight:800",
    "font-size:12px",
    "white-space:nowrap",
  ].join(";");
  button.addEventListener("click", onClick);
  return button;
}

function compactStatusText(text: string, state: FloatingPanelState): string {
  if (state === "busy") return "处理中";
  if (state === "done") return "完成";
  if (state === "paused") return "暂停";
  if (state === "offline") return "离线";
  if (state === "error") return "错误";
  if (/自动关闭|auto off/i.test(text)) return "翻译";
  if (/backend connected|ready|已连接/i.test(text)) return "翻译";
  return text.length > 4 ? "翻译" : text;
}

function currentPanelPosition(root: HTMLElement): FloatingPanelPosition {
  const rect = root.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return { left: rect.left, top: rect.top };
  const left = Number.parseFloat(root.style.left);
  const top = Number.parseFloat(root.style.top);
  if (Number.isFinite(left) && Number.isFinite(top)) return { left, top };
  return defaultPosition();
}

function defaultPosition(): FloatingPanelPosition {
  return {
    left: Math.max(VIEWPORT_MARGIN, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN),
    top: Math.max(VIEWPORT_MARGIN, window.innerHeight - PANEL_HEIGHT - VIEWPORT_MARGIN),
  };
}

function clampPosition(position: FloatingPanelPosition): FloatingPanelPosition {
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN);
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - PANEL_HEIGHT - VIEWPORT_MARGIN);
  return {
    left: Math.max(VIEWPORT_MARGIN, Math.min(maxLeft, position.left)),
    top: Math.max(VIEWPORT_MARGIN, Math.min(maxTop, position.top)),
  };
}

async function loadStoredPosition(): Promise<FloatingPanelPosition | null> {
  try {
    const storage = globalThis.chrome?.storage?.local;
    if (!storage) return null;
    const saved = await storage.get([POSITION_KEY]);
    const value = saved?.[POSITION_KEY] as Partial<FloatingPanelPosition> | undefined;
    if (!value || typeof value.left !== "number" || typeof value.top !== "number") return null;
    return clampPosition({ left: value.left, top: value.top });
  } catch {
    return null;
  }
}

async function saveStoredPosition(position: FloatingPanelPosition): Promise<void> {
  try {
    await globalThis.chrome?.storage?.local?.set({ [POSITION_KEY]: clampPosition(position) });
  } catch {
    // Position persistence is best-effort; dragging should keep working even when storage is unavailable.
  }
}
