import type { UmtBackendHttpRequest, UmtBackendHttpResponse } from "./messages.js";

export function isUmtOwnedMutation(mutation: MutationRecord): boolean {
  const target = mutation.target instanceof HTMLElement ? mutation.target : mutation.target.parentElement;
  if (target?.closest("[data-umt-overlay-root], [data-umt-chapter-progress], [data-umt-surface-button], [data-umt-panel], [data-umt-debug-root], [data-umt-selection-layer]")) return true;
  for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
    if (node instanceof HTMLElement && node.matches("[data-umt-overlay-root], [data-umt-chapter-progress], [data-umt-surface-button], [data-umt-panel], [data-umt-debug-root], [data-umt-selection-layer]")) return true;
  }
  return false;
}

export function createJobSessionId(): string {
  return `session:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function debounce<T extends (...args: never[]) => void>(fn: T, delayMs: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  }) as T;
}

export function formatShortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

export async function requestBackendHttp(request: { url: string; init?: UmtBackendHttpRequest["init"] }): Promise<UmtBackendHttpResponse> {
  return await chrome.runtime.sendMessage({ source: "umt-content", command: "backendHttp", ...request });
}
