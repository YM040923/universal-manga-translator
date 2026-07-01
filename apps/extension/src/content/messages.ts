export type UmtContentCommandName = "translate" | "refresh" | "togglePause" | "clearPage" | "selectRegion" | "retranslate";

export interface UmtContentCommand {
  source: "umt-popup";
  command: UmtContentCommandName;
}

export interface UmtCaptureVisibleTabRequest {
  source: "umt-content";
  command: "captureVisibleTab";
}

export interface UmtCaptureVisibleTabSuccess {
  ok: true;
  imageData: string;
}

export interface UmtCaptureVisibleTabFailure {
  ok: false;
  error: string;
}

export type UmtCaptureVisibleTabResponse = UmtCaptureVisibleTabSuccess | UmtCaptureVisibleTabFailure;

export function isUmtContentCommand(value: unknown): value is UmtContentCommand {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtContentCommand>;
  return candidate.source === "umt-popup" && (
    candidate.command === "translate" ||
    candidate.command === "refresh" ||
    candidate.command === "togglePause" ||
    candidate.command === "clearPage" ||
    candidate.command === "selectRegion" ||
    candidate.command === "retranslate"
  );
}

export function isUmtCaptureVisibleTabRequest(value: unknown): value is UmtCaptureVisibleTabRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtCaptureVisibleTabRequest>;
  return candidate.source === "umt-content" && candidate.command === "captureVisibleTab";
}
