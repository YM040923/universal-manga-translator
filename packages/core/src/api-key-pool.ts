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
  blockedUntil: number;
  failures: number;
  lastError?: string;
}

const NEVER = Number.POSITIVE_INFINITY;

function isBlockedAt(key: KeyState, now: number): boolean {
  return key.blockedUntil > now;
}

/**
 * Round-robin pool over OCR API keys. Keys that exhaust quota or fail auth are
 * blocked permanently (until `resetFailures`); transient rate-limit errors use
 * a short cooldown so a single 429 does not permanently remove a key from
 * rotation.
 */
export class ApiKeyPool {
  private cursor = 0;
  private readonly keys: KeyState[];

  constructor(values: string[]) {
    this.keys = values.map((value, index) => ({ value: value.trim(), label: `key#${index + 1}`, blockedUntil: 0, failures: 0 })).filter((item) => item.value.length > 0);
  }

  next(): ApiKeyLease | null {
    const now = Date.now();
    if (!this.keys.length || this.keys.every((item) => isBlockedAt(item, now))) return null;
    for (let checked = 0; checked < this.keys.length; checked += 1) {
      const index = this.cursor % this.keys.length;
      this.cursor = (this.cursor + 1) % this.keys.length;
      const key = this.keys[index]!;
      if (!isBlockedAt(key, now)) return { value: key.value, label: key.label, index };
    }
    return null;
  }

  reportFailure(lease: ApiKeyLease, error: unknown, cooldownMs = NEVER): void {
    const key = this.keys[lease.index];
    if (!key) return;
    key.failures += 1;
    key.lastError = shortError(error);
    key.blockedUntil = Date.now() + (Number.isFinite(cooldownMs) ? Math.max(0, cooldownMs) : NEVER);
  }

  reportSuccess(lease: ApiKeyLease): void {
    const key = this.keys[lease.index];
    if (!key) return;
    key.blockedUntil = 0;
    delete key.lastError;
  }

  resetFailures(): void {
    for (const key of this.keys) {
      key.blockedUntil = 0;
      delete key.lastError;
    }
  }

  status(): ApiKeyPoolStatus {
    const now = Date.now();
    return {
      count: this.keys.length,
      available: this.keys.filter((item) => !isBlockedAt(item, now)).length,
      keys: this.keys.map((item) => ({
        label: item.label,
        state: isBlockedAt(item, now) ? "blocked" : "ready",
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
