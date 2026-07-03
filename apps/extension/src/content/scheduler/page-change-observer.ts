export type PageChangeReason = "mutation" | "image-load" | "resize-observer";

export interface PageChangeObserverOptions {
  onChange: (reason: PageChangeReason) => void;
  debounceMs?: number;
}

export class PageChangeObserver {
  private mutationObserver?: MutationObserver;
  private resizeObserver?: ResizeObserver;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  constructor(private readonly root: Document, private readonly options: PageChangeObserverOptions) {
    this.debounceMs = options.debounceMs ?? 250;
  }

  start(): void {
    this.root.addEventListener("load", this.onLoad, true);
    this.mutationObserver = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => [...mutation.addedNodes].some((node) => this.isRelevantAddedNode(node)))) this.schedule("mutation");
    });
    this.mutationObserver.observe(this.root.documentElement, { childList: true, subtree: true });
    const ResizeObserverCtor = this.root.defaultView?.ResizeObserver ?? globalThis.ResizeObserver;
    if (ResizeObserverCtor) {
      this.resizeObserver = new ResizeObserverCtor(() => this.schedule("resize-observer"));
      this.resizeObserver.observe(this.root.documentElement);
    }
  }

  stop(): void {
    this.root.removeEventListener("load", this.onLoad, true);
    this.mutationObserver?.disconnect();
    this.resizeObserver?.disconnect();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private readonly onLoad = (event: Event): void => {
    if (event.target instanceof this.root.defaultView!.HTMLImageElement) this.schedule("image-load");
  };

  private isRelevantAddedNode(node: Node): boolean {
    if (node.nodeType !== (this.root.defaultView?.Node.ELEMENT_NODE ?? 1)) return false;
    const element = node as Element;
    return !isUmtOverlayElement(element);
  }

  private schedule(reason: PageChangeReason): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.options.onChange(reason);
    }, this.debounceMs);
  }
}

function isUmtOverlayElement(element: Element): boolean {
  const dataset = "dataset" in element ? (element as HTMLElement).dataset : undefined;
  if (dataset && (dataset.umtOverlayRoot === "true" || dataset.umtSurfaceId || dataset.umtRegionId || dataset.umtTextChip)) return true;
  return Boolean(element.closest?.("[data-umt-overlay-root='true'],[data-umt-surface-id],[data-umt-region-id],[data-umt-text-chip]"));
}
