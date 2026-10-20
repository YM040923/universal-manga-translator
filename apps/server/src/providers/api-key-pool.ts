export interface ApiKeyLease {
  value: string;
  label: string;
  index: number;
}

export interface ApiKeyStatusItem {
  label: string;
  state: "ready" | "blocked";
  failures: number;
  lastError?: string;
}

export interface ApiKeyPoolStatus {
  count: number;
  available: number;
  keys: ApiKeyStatusItem[];
}

interface KeyState {
  value: string;
  label: string;
  blocked: boolean;
  failures: number;
  lastError?: string;
}

export class ApiKeyPool {
  private cursor = 0;
  private readonly keys: KeyState[];

  constructor(values: string[]) {
    this.keys = values.map((value, index) => ({ value: value.trim(), label: `key#${index + 1}`, blocked: false, failures: 0 })).filter((item) => item.value.length > 0);
  }

  next(): ApiKeyLease | null {
    if (!this.keys.length || this.keys.every((item) => item.blocked)) return null;
    for (let checked = 0; checked < this.keys.length; checked += 1) {
      const index = this.cursor % this.keys.length;
      this.cursor = (this.cursor + 1) % this.keys.length;
      const key = this.keys[index]!;
      if (!key.blocked) return { value: key.value, label: key.label, index };
    }
    return null;
  }

  reportFailure(lease: ApiKeyLease, error: unknown): void {
    const key = this.keys[lease.index];
    if (!key) return;
    key.failures += 1;
    key.lastError = shortError(error);
    key.blocked = true;
  }

  reportSuccess(lease: ApiKeyLease): void {
    const key = this.keys[lease.index];
    if (!key) return;
    delete key.lastError;
  }

  resetFailures(): void {
    for (const key of this.keys) {
      key.blocked = false;
      delete key.lastError;
    }
  }

  status(): ApiKeyPoolStatus {
    return {
      count: this.keys.length,
      available: this.keys.filter((item) => !item.blocked).length,
      keys: this.keys.map((item) => ({
        label: item.label,
        state: item.blocked ? "blocked" : "ready",
        failures: item.failures,
        ...(item.lastError ? { lastError: item.lastError } : {}),
      })),
    };
  }
}

function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

