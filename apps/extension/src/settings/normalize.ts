export function normalizeOptionalHttpUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.pathname = url.pathname.replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function normalizeOpenAICompatibleBaseUrl(value: unknown): string {
  const normalized = normalizeOptionalHttpUrl(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = "/v1";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return normalized;
  }
  return normalized;
}

export function normalizeNonEmptyString(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : fallback;
}

export function normalizeStringList(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const normalized = value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter((item) => item.length > 0);
  return normalized.length ? normalized : [...fallback];
}

export function normalizeJsonObjectText(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    return value.trim();
  } catch {
    return fallback;
  }
}

export function normalizeInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const integer = Math.trunc(value);
  if (integer < min) return fallback;
  if (integer > max) return max;
  return integer;
}

export function normalizeNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(numberValue)) return fallback;
  const clamped = Math.max(min, Math.min(max, numberValue));
  return Math.round(clamped * 100) / 100;
}
