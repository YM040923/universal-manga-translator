export interface ServerConfig {
  port: number;
  provider: string;
  targetLanguage: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
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
    maxImageLongEdge: Number(env.MAX_IMAGE_LONG_EDGE ?? 1600),
    jpegQuality: Number(env.JPEG_QUALITY ?? 0.75),
  };
}
