import type { SurfaceTask } from "@umt/shared";

const MAX_IMAGE_FETCH_BYTES = 32 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 30000;

export interface TaskImageInput {
  buffer: Buffer;
  source: "imageData" | "imageUrl";
}

export interface ReadTaskImageOptions {
  attempts?: number;
  retryDelayMs?: number;
  /** External cancellation signal (user cancel); aborts in-flight fetches. */
  signal?: AbortSignal;
}

function decodeImageData(imageData: string): Buffer {
  const base64 = imageData.includes(",") ? imageData.split(",").at(-1) ?? "" : imageData;
  return Buffer.from(base64, "base64");
}

/**
 * Rejects image URLs that could be abused as an SSRF primitive: non-http(s)
 * schemes, embedded credentials, and hosts in private / loopback / link-local
 * / reserved ranges. Manga CDNs are public, so private hosts are never a
 * legitimate image source for the backend.
 */
export function assertAllowedImageUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Image URL is invalid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Image URL must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Image URL must not contain credentials.");
  }
  if (isBlockedImageHost(parsed.hostname)) {
    throw new Error("Image URL host is not allowed.");
  }
}

function isBlockedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  const parts = host.split(".").map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 127 || a === 10) return true; // loopback, private 10/8
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
  if (a === 192 && b === 168) return true; // private 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 0 || a >= 224) return true; // reserved / multicast / broadcast
  return false;
}

export async function readTaskImage(task: SurfaceTask, options: ReadTaskImageOptions = {}): Promise<TaskImageInput> {
  if (task.imageData) return { buffer: decodeImageData(task.imageData), source: "imageData" };
  if (task.imageUrl) {
    assertAllowedImageUrl(task.imageUrl);
    const attempts = options.attempts ?? 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
      try {
        const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
        const response = await fetch(task.imageUrl, {
          headers: { referer: task.pageUrl, "user-agent": "UniversalMangaTranslator/0.1" },
          signal,
        });
        if (!response.ok) throw new Error(`Image URL fetch failed: ${response.status} ${task.imageUrl}`);
        const declaredLength = Number(response.headers.get("content-length") ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_FETCH_BYTES) {
          throw new Error(`Image URL response exceeds the ${MAX_IMAGE_FETCH_BYTES / 1024 / 1024}MB limit.`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_IMAGE_FETCH_BYTES) {
          throw new Error(`Image URL response exceeds the ${MAX_IMAGE_FETCH_BYTES / 1024 / 1024}MB limit.`);
        }
        return { buffer, source: "imageUrl" };
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.name === "AbortError") {
          lastError = new Error(`Image URL fetch timed out after ${IMAGE_FETCH_TIMEOUT_MS}ms.`);
        }
        if (attempt < attempts) await delay((options.retryDelayMs ?? 250) * attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  throw new Error("Surface task has neither imageData nor imageUrl.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
