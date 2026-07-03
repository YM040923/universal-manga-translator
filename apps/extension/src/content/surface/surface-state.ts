export type SurfaceStatus = "idle" | "queued" | "fetching" | "ocr" | "translating" | "rendering" | "completed" | "cached" | "empty" | "failed" | "paused" | "cancelled";

export interface SurfaceStatusView {
  label: string;
  color: string;
}

const STATUS_VIEWS: Record<SurfaceStatus, SurfaceStatusView> = {
  idle: { label: "翻译", color: "#64748b" },
  queued: { label: "排队", color: "#2563eb" },
  fetching: { label: "取图", color: "#0891b2" },
  ocr: { label: "OCR", color: "#7c3aed" },
  translating: { label: "翻译中", color: "#ea580c" },
  rendering: { label: "渲染", color: "#ca8a04" },
  completed: { label: "完成", color: "#16a34a" },
  cached: { label: "缓存", color: "#15803d" },
  empty: { label: "空", color: "#a16207" },
  failed: { label: "重试", color: "#dc2626" },
  paused: { label: "暂停", color: "#475569" },
  cancelled: { label: "取消", color: "#334155" },
};

export function surfaceStatusView(status: SurfaceStatus): SurfaceStatusView {
  return STATUS_VIEWS[status];
}
