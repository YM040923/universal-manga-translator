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

/**
 * Identity of the frames the top document embeds. A reader that adds an iframe later, or points an
 * existing one at a new chapter, leaves that frame without a content script until it is injected again.
 */
export function readerFrameSignature(root: Document = document): string {
  return [...root.querySelectorAll<HTMLIFrameElement>("iframe")].map((frame) => frame.src).join("|").slice(0, 2048);
}

export interface FullscreenCheckDocument {
  readonly fullscreen?: boolean | undefined;
  readonly fullscreenElement?: Element | null | undefined;
  readonly webkitIsFullscreen?: boolean | undefined;
  readonly webkitFullscreenElement?: Element | null | undefined;
  readonly webkitCurrentFullScreenElement?: Element | null | undefined;
}

/**
 * Whether the rest of the page is hidden behind this document. A reader that fullscreenes its own
 * iframe leaves that frame's `fullscreenElement` null, because the fullscreened element lives in the
 * parent document, so the boolean flags are what tell the frame it is alone on screen and must host
 * its own widgets.
 */
export function isDocumentDisplayedFullscreen(doc: FullscreenCheckDocument = document): boolean {
  return Boolean(
    doc.fullscreen
    || doc.webkitIsFullscreen
    || doc.fullscreenElement
    || doc.webkitFullscreenElement
    || doc.webkitCurrentFullScreenElement
  );
}

export interface ScreenCoveringView {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly screen?: { readonly width: number; readonly height: number } | null;
}

/** Page zoom scales a fullscreen frame's CSS viewport, so coverage gets some slack. */
const SCREEN_COVERAGE = 0.9;

/**
 * A frame gets no signal of its own when the page fullscreened the frame element: Chrome leaves
 * `document.fullscreen` false and fires no event inside it. What it can observe is its viewport
 * covering the screen, which only happens once the frame is alone on it. A near-miss embed is
 * harmless because both widgets restore to the same saved position and act on the whole tab.
 */
export function isFrameAloneOnScreen(view: ScreenCoveringView): boolean {
  const screen = view.screen;
  if (!screen || !screen.width || !screen.height) return false;
  return view.innerWidth >= screen.width * SCREEN_COVERAGE && view.innerHeight >= screen.height * SCREEN_COVERAGE;
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
