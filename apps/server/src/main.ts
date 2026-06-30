import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "./api/server.js";
import { EventBus } from "./api/events.js";
import { SurfaceCache } from "./cache/surface-cache.js";
import { openDatabase } from "./cache/db.js";
import { loadConfig } from "./config/env.js";
import { MockProvider } from "./providers/mock-provider.js";
import { OpenAIVisionProvider } from "./providers/openai-vision-provider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const dataDir = resolve(__dirname, "../data");
mkdirSync(dataDir, { recursive: true });
const surfaceCache = new SurfaceCache(openDatabase(resolve(dataDir, "cache.sqlite")));
const visionProvider = config.provider === "openai-compatible"
  ? new OpenAIVisionProvider({ baseUrl: config.openaiBaseUrl, apiKey: config.openaiApiKey, model: config.openaiModel, targetLanguage: config.targetLanguage })
  : new MockProvider();
const eventBus = new EventBus();
const app = await buildServer({ provider: config.provider, targetLanguage: config.targetLanguage, visionProvider, surfaceCache, eventBus });
await app.listen({ host: "127.0.0.1", port: config.port });
console.log(`Universal Manga Translator backend listening on http://127.0.0.1:${config.port}`);

