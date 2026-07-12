export type FloatingPanelState = "idle" | "busy" | "done" | "paused" | "offline" | "error";

export interface FloatingPanelActions {
  onToggleOverlayVisibility: (visible: boolean) => void;
  onRetranslatePage?: () => void;
  onSelectRegion?: () => void;
}

import { currentPanelPosition, DRAG_THRESHOLD_PX, loadStoredPosition, saveStoredPosition, type FloatingPanelPosition, clampPosition } from "./floating-position.js";
import {
  FLOATING_BUTTON_STYLE,
  FLOATING_EYE_ICON_STYLE,
  FLOATING_ICON_STYLE,
  FLOATING_MENU_BUTTON_STYLE,
  FLOATING_MENU_STYLE,
  FLOATING_ROOT_STYLE,
  FLOATING_STATUS_STYLE,
  floatingButtonStatusStyle,
} from "./floating-styles.js";

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
    this.root.style.cssText = FLOATING_ROOT_STYLE;

    this.button = document.createElement("button");
    this.button.dataset.umtFloatingButton = "true";
    this.button.type = "button";
    this.button.style.cssText = FLOATING_BUTTON_STYLE;
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
    this.icon.style.cssText = FLOATING_ICON_STYLE;

    this.eyeIcon = document.createElement("span");
    this.eyeIcon.dataset.umtEyeIcon = "true";
    this.eyeIcon.style.cssText = FLOATING_EYE_ICON_STYLE;

    this.icon.append(this.eyeIcon);

    this.status = document.createElement("span");
    this.status.dataset.umtStatus = "true";
    this.status.textContent = "翻译";
    this.status.style.cssText = FLOATING_STATUS_STYLE;

    this.button.append(this.icon, this.status);
    this.root.append(this.button);

    if (actions.onRetranslatePage || actions.onSelectRegion) {
      this.menu = document.createElement("div");
      this.menu.dataset.umtFloatingMenu = "true";
      this.menu.style.cssText = FLOATING_MENU_STYLE;
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
    const statusStyle = floatingButtonStatusStyle(state);
    this.button.style.background = statusStyle.background;
    this.button.style.boxShadow = statusStyle.boxShadow;
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
  button.style.cssText = FLOATING_MENU_BUTTON_STYLE;
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
