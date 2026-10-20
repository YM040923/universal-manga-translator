export interface ApiKeyLease {
  value: string;
  label: string;
  index: number;
}

export type ApiKeyPoolState = "ready" | "cooldown" | "disabled";

/** `cooldown` recovers on its own, `disabled` waits for a config change or an explicit reset. */
export type KeyFailureSeverity = "cooldown" | "disabled";

export interface ApiKeyStatusItem {
  label: string;
  state: ApiKeyPoolState;
  failures: number;
  retryAfterMs?: number;
  lastError?: string;
}

export interface ApiKeyPoolStatus {
  count: number;
  available: number;
  keys: ApiKeyStatusItem[];
}

export interface ApiKeyPoolOptions {
  now?: () => number;
  baseCooldownMs?: number;
  maxCooldownMs?: number;
}

interface KeyState {
  value: string;
  label: string;
  failures: number;
  retryAt: number;
  disabled: boolean;
  lastError?: string;
}

const DEFAULT_BASE_COOLDOWN_MS = 30_000;
const DEFAULT_MAX_COOLDOWN_MS = 15 * 60_000;

/**
 * Rotation and failure parking for one provider instance. Saving the OCR config
 * builds a new provider, so a `disabled` key only returns to rotation with a new pool.
 */
export class ApiKeyPool {
  private cursor = 0;
  private readonly keys: KeyState[];
  private readonly now: () => number;
  private readonly baseCooldownMs: number;
  private readonly maxCooldownMs: number;

  constructor(values: string[], options: ApiKeyPoolOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.baseCooldownMs = options.baseCooldownMs ?? DEFAULT_BASE_COOLDOWN_MS;
    this.maxCooldownMs = options.maxCooldownMs ?? DEFAULT_MAX_COOLDOWN_MS;
    this.keys = values.map((value, index) => ({ value: value.trim(), label: `key#${index + 1}`, failures: 0, retryAt: 0, disabled: false })).filter((item) => item.value.length > 0);
  }

  next(): ApiKeyLease | null {
    const now = this.now();
    for (let checked = 0; checked < this.keys.length; checked += 1) {
      const index = this.cursor % this.keys.length;
      this.cursor = (this.cursor + 1) % this.keys.length;
      const key = this.keys[index]!;
      if (!key.disabled && key.retryAt <= now) return { value: key.value, label: key.label, index };
    }
    return null;
  }

  reportFailure(lease: ApiKeyLease, error: unknown, severity: KeyFailureSeverity): void {
    const key = this.keys[lease.index];
    if (!key) return;
    key.failures += 1;
    key.lastError = shortError(error);
    if (severity === "disabled") key.disabled = true;
    else key.retryAt = this.now() + this.cooldownMs(key.failures);
  }

  reportSuccess(lease: ApiKeyLease): void {
    const key = this.keys[lease.index];
    if (!key) return;
    key.failures = 0;
    key.retryAt = 0;
    delete key.lastError;
  }

  status(): ApiKeyPoolStatus {
    const now = this.now();
    return {
      count: this.keys.length,
      available: this.keys.filter((item) => !item.disabled && item.retryAt <= now).length,
      keys: this.keys.map((item) => ({
        label: item.label,
        state: item.disabled ? "disabled" as const : item.retryAt > now ? "cooldown" as const : "ready" as const,
        failures: item.failures,
        ...(item.retryAt > now && !item.disabled ? { retryAfterMs: item.retryAt - now } : {}),
        ...(item.lastError ? { lastError: item.lastError } : {}),
      })),
    };
  }

  private cooldownMs(failures: number): number {
    return Math.min(this.maxCooldownMs, this.baseCooldownMs * 2 ** (failures - 1));
  }
}

function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
