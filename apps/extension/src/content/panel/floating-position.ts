export interface FloatingPanelPosition {
  left: number;
  top: number;
}

export const DRAG_THRESHOLD_PX = 4;

const POSITION_KEY = "umtFloatingPanelPosition";
const PANEL_WIDTH = 42;
const PANEL_HEIGHT = 42;
const VIEWPORT_MARGIN = 8;

export function currentPanelPosition(root: HTMLElement): FloatingPanelPosition {
  const rect = root.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return { left: rect.left, top: rect.top };
  const left = Number.parseFloat(root.style.left);
  const top = Number.parseFloat(root.style.top);
  if (Number.isFinite(left) && Number.isFinite(top)) return { left, top };
  return defaultPosition();
}

export function clampPosition(position: FloatingPanelPosition): FloatingPanelPosition {
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN);
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - PANEL_HEIGHT - VIEWPORT_MARGIN);
  return {
    left: Math.max(VIEWPORT_MARGIN, Math.min(maxLeft, position.left)),
    top: Math.max(VIEWPORT_MARGIN, Math.min(maxTop, position.top)),
  };
}

export async function loadStoredPosition(): Promise<FloatingPanelPosition | null> {
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

export async function saveStoredPosition(position: FloatingPanelPosition): Promise<void> {
  try {
    await globalThis.chrome?.storage?.local?.set({ [POSITION_KEY]: clampPosition(position) });
  } catch {
    // Position persistence is best-effort; dragging should keep working even when storage is unavailable.
  }
}

function defaultPosition(): FloatingPanelPosition {
  return {
    left: Math.max(VIEWPORT_MARGIN, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN),
    top: Math.max(VIEWPORT_MARGIN, window.innerHeight - PANEL_HEIGHT - VIEWPORT_MARGIN),
  };
}
