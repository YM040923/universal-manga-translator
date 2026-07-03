import type { ServerEvent } from "@umt/shared/protocol";
import type { Size, SurfaceResult } from "@umt/shared/types";
import { isRenderableSurfaceResult } from "../translation-result.js";

interface TrackedSurface {
  element: HTMLElement;
  naturalSize: Size;
}

export interface EventResultRouterOptions {
  render: (element: HTMLElement, naturalSize: Size, result: SurfaceResult) => void;
}

export class EventResultRouter {
  private readonly tracked = new Map<string, TrackedSurface>();
  private sessionId = "";

  constructor(private readonly options: EventResultRouterOptions) {}

  setSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.clear();
  }

  track(surfaceId: string, element: HTMLElement, naturalSize: Size): void {
    this.tracked.set(surfaceId, { element, naturalSize });
  }

  clear(): void {
    this.tracked.clear();
  }

  handle(event: ServerEvent): boolean {
    if (event.type !== "job.completed" && event.type !== "job.cached") return false;
    if (this.sessionId && event.jobSessionId && event.jobSessionId !== this.sessionId) return false;
    if (!isRenderableSurfaceResult(event.result)) return false;
    const target = this.tracked.get(event.surfaceId);
    if (!target) return false;
    this.options.render(target.element, target.naturalSize, event.result);
    return true;
  }
}
