import type { SurfaceTask } from "@umt/shared";

export interface TaskImageInput {
  buffer: Buffer;
  source: "imageData" | "imageUrl";
}

function decodeImageData(imageData: string): Buffer {
  const base64 = imageData.includes(",") ? imageData.split(",").at(-1) ?? "" : imageData;
  return Buffer.from(base64, "base64");
}

export async function readTaskImage(task: SurfaceTask): Promise<TaskImageInput> {
  if (task.imageData) return { buffer: decodeImageData(task.imageData), source: "imageData" };
  if (task.imageUrl) {
    const response = await fetch(task.imageUrl, { headers: { referer: task.pageUrl, "user-agent": "UniversalMangaTranslator/0.1" } });
    if (!response.ok) throw new Error(`Image URL fetch failed: ${response.status} ${task.imageUrl}`);
    return { buffer: Buffer.from(await response.arrayBuffer()), source: "imageUrl" };
  }
  throw new Error("Surface task has neither imageData nor imageUrl.");
}
