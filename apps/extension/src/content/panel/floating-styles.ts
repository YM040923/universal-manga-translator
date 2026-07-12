import type { FloatingPanelState } from "./floating-panel.js";

export const FLOATING_ROOT_STYLE = [
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

export const FLOATING_BUTTON_STYLE = [
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

export const FLOATING_ICON_STYLE = [
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

export const FLOATING_EYE_ICON_STYLE = "font-size:16px;line-height:1;transform:translateY(-1px);";
export const FLOATING_STATUS_STYLE = "position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;";

export const FLOATING_MENU_STYLE = [
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

export const FLOATING_MENU_BUTTON_STYLE = [
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

export function floatingButtonStatusStyle(state: FloatingPanelState): { background: string; boxShadow: string } {
  if (state === "offline" || state === "error") return { background: "linear-gradient(135deg,#64748b,#334155)", boxShadow: "0 8px 20px rgba(51,65,85,.20)" };
  if (state === "busy") return { background: "linear-gradient(135deg,#2563eb,#4f46e5)", boxShadow: "0 8px 20px rgba(37,99,235,.22)" };
  if (state === "done") return { background: "linear-gradient(135deg,#16a34a,#15803d)", boxShadow: "0 8px 20px rgba(22,163,74,.22)" };
  if (state === "paused") return { background: "linear-gradient(135deg,#f59e0b,#d97706)", boxShadow: "0 8px 20px rgba(217,119,6,.20)" };
  return { background: "linear-gradient(135deg,#ff7a1a,#ff4d00)", boxShadow: "0 8px 20px rgba(255,96,20,.22)" };
}
