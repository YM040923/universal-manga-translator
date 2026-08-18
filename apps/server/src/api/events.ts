import type { ServerEvent } from "@umt/shared";

type Listener = (event: ServerEvent) => void;

export class EventBus {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: ServerEvent): void {
    // One broken listener (e.g. a closing websocket) must not break the whole
    // event chain and turn a valid submission into a 500.
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // ignore per-listener failures
      }
    }
  }
}
