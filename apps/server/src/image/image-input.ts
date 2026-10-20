import type { SurfaceTask } from "@umt/shared";

export interface TaskImageInput {
  buffer: Buffer;
  source: "imageData" | "imageUrl";
}

export interface ReadTaskImageOptions {
  attempts?: number;
  retryDelayMs?: number;
}

function decodeImageData(imageData: string): Buffer {
  const base64 = imageData.includes(",") ? imageData.split(",").at(-1) ?? "" : imageData;
  return Buffer.from(base64, "base64");
}

export async function readTaskImage(task: SurfaceTask, options: ReadTaskImageOptions = {}): Promise<TaskImageInput> {
  if (task.imageData) return { buffer: decodeImageData(task.imageData), source: "imageData" };
  if (task.imageUrl) {
    const attempts = options.attempts ?? 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(task.imageUrl, { headers: { referer: task.pageUrl, "user-agent": "UniversalMangaTranslator/0.1" } });
        if (!response.ok) throw new Error(`Image URL fetch failed: ${response.status} ${task.imageUrl}`);
        return { buffer: Buffer.from(await response.arrayBuffer()), source: "imageUrl" };
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await delay((options.retryDelayMs ?? 250) * attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  throw new Error("Surface task has neither imageData nor imageUrl.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
