export interface DesktopBackendStatusViewInput {
  running: boolean;
  owned: boolean;
  url: string;
  provider?: string;
  targetLanguage?: string;
  ocrConfigured?: boolean;
  translatorConfigured?: boolean;
  keyPoolAvailable?: number;
  keyPoolCount?: number;
}

export interface DesktopBackendStatusView {
  statusText: string;
  statusClass: string;
  ownerText: string;
  metaText: string;
  badges: string[];
  startDisabled: boolean;
  stopDisabled: boolean;
  configDisabled: boolean;
}

export function backendStatusView(status: DesktopBackendStatusViewInput): DesktopBackendStatusView {
  const running = status.running === true;
  return {
    statusText: running ? "运行中" : "未运行",
    statusClass: `pill ${running ? "ok" : "bad"}`,
    ownerText: running ? (status.owned ? "本软件启动" : "已检测到已有后端") : "等待启动",
    metaText: running ? [status.provider, status.targetLanguage, status.url].filter(Boolean).join(" | ") : status.url,
    badges: running ? backendBadges(status) : [],
    startDisabled: running,
    stopDisabled: !running,
    configDisabled: !running,
  };
}

export function userFacingError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/^Error invoking remote method '[^']+': Error: /, "")
    .replace(/^Error invoking remote method \"[^\"]+\": Error: /, "")
    .trim() || "操作失败，请查看后端状态和配置";
}

function backendBadges(status: DesktopBackendStatusViewInput): string[] {
  const badges: string[] = [];
  if (typeof status.ocrConfigured === "boolean") badges.push(`OCR：${status.ocrConfigured ? "已配置" : "未配置"}`);
  if (typeof status.translatorConfigured === "boolean") badges.push(`翻译：${status.translatorConfigured ? "已配置" : "未配置"}`);
  if (typeof status.keyPoolCount === "number") {
    const available = typeof status.keyPoolAvailable === "number" ? status.keyPoolAvailable : status.keyPoolCount;
    badges.push(`Key：${available}/${status.keyPoolCount} 可用`);
  }
  return badges;
}
