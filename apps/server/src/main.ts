import { buildServer } from "./api/server";
import { loadConfig } from "./config/env";

const config = loadConfig();
const app = await buildServer({ provider: config.provider, targetLanguage: config.targetLanguage });
await app.listen({ host: "127.0.0.1", port: config.port });
console.log(`Universal Manga Translator backend listening on http://127.0.0.1:${config.port}`);

