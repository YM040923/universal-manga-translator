import type { FloatingPanelState } from "./floating-panel.js";

export function compactStatusText(text: string, state: FloatingPanelState): string {
  if (state === "busy") return "处理中";
  if (state === "done") return "完成";
  if (state === "paused") return "暂停";
  if (state === "offline") return "离线";
  if (state === "error") return "错误";
  if (/自动关闭|auto off/i.test(text)) return "翻译";
  if (/backend connected|ready|已连接/i.test(text)) return "翻译";
  return text.length > 4 ? "翻译" : text;
}
