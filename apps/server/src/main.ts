import { buildServer } from "./api/server.js";
import { loadConfig } from "./config/env.js";
import { MockProvider } from "./providers/mock-provider.js";
import { OpenAIVisionProvider } from "./providers/openai-vision-provider.js";

const config = loadConfig();
const visionProvider = config.provider === "openai-compatible"
  ? new OpenAIVisionProvider({ baseUrl: config.openaiBaseUrl, apiKey: config.openaiApiKey, model: config.openaiModel, targetLanguage: config.targetLanguage })
  : new MockProvider();
const app = await buildServer({ provider: config.provider, targetLanguage: config.targetLanguage, visionProvider });
await app.listen({ host: "127.0.0.1", port: config.port });
console.log(`Universal Manga Translator backend listening on http://127.0.0.1:${config.port}`);
