export type UmtContentCommandName = "translate" | "refresh" | "togglePause" | "clearPage";

export interface UmtContentCommand {
  source: "umt-popup";
  command: UmtContentCommandName;
}

export function isUmtContentCommand(value: unknown): value is UmtContentCommand {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UmtContentCommand>;
  return candidate.source === "umt-popup" && (
    candidate.command === "translate" ||
    candidate.command === "refresh" ||
    candidate.command === "togglePause" ||
    candidate.command === "clearPage"
  );
}