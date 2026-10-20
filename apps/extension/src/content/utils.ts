import type { UmtBackendHttpRequest, UmtBackendHttpResponse } from "./messages.js";

const UMT_OWNED_ROOTS = "[data-umt-overlay-root], [data-umt-chapter-progress], [data-umt-surface-button], [data-umt-panel], [data-umt-debug-root], [data-umt-selection-layer]";

export function isUmtOwnedMutation(mutation: MutationRecord): boolean {
  const target = mutation.target instanceof HTMLElement ? mutation.target : mutation.target.parentElement;
  if (target?.closest(UMT_OWNED_ROOTS)) return true;
  for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
    if (node instanceof HTMLElement && node.matches(UMT_OWNED_ROOTS)) return true;
  }
  return false;
}

/**
 * Re-injection (site re-enabled, extension reload) leaves the previous script's
 * nodes behind with no owner that could ever remove them.
 */
export function reclaimOrphanUmtNodes(): void {
  for (const node of [...document.querySelectorAll(UMT_OWNED_ROOTS)]) node.remove();
}

export function createJobSessionId(): string {
  return `session:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

export function debounce<T extends (...args: never[]) => void>(fn: T, delayMs: number): Debounced<Parameters<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  }) as Debounced<Parameters<T>>;
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return debounced;
}

export function formatShortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

export async function requestBackendHttp(request: { url: string; init?: UmtBackendHttpRequest["init"] }): Promise<UmtBackendHttpResponse> {
  return await chrome.runtime.sendMessage({ source: "umt-content", command: "backendHttp", ...request });
}
