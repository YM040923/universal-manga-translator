import { existsSync, readFileSync } from "node:fs";

export interface ServerConfig {
  port: number;
  provider: string;
  targetLanguage: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiImageInputFormat: "image-url" | "image-field";
  maxImageLongEdge: number;
  jpegQuality: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 47831),
    provider: env.VISION_PROVIDER ?? "mock",
    targetLanguage: env.TARGET_LANGUAGE ?? "zh-CN",
    openaiBaseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    openaiApiKey: env.OPENAI_API_KEY ?? "",
    openaiModel: env.OPENAI_MODEL ?? "gpt-4.1-mini",
    openaiImageInputFormat: env.OPENAI_IMAGE_INPUT_FORMAT === "image-field" ? "image-field" : "image-url",
    maxImageLongEdge: Number(env.MAX_IMAGE_LONG_EDGE ?? 1600),
    jpegQuality: Number(env.JPEG_QUALITY ?? 0.75),
  };
}

export function loadConfigFromEnvFile(path: string, env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const fileEnv = existsSync(path) ? parseEnvText(readFileSync(path, "utf8")) : {};
  return loadConfig({ ...fileEnv, ...env });
}

export function parseEnvText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}
