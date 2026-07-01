import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigFromEnvFile } from "./env.js";

test("loadConfigFromEnvFile merges dotenv values without printing secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-env-"));
  try {
    const envPath = join(dir, ".env");
    writeFileSync(envPath, [
      "VISION_PROVIDER=openai-compatible",
      "OPENAI_BASE_URL=https://cf.ai-pixel.online/v1",
      "OPENAI_API_KEY=secret",
      "OPENAI_MODEL=gpt-5.4-mini",
      "OPENAI_IMAGE_INPUT_FORMAT=image-field",
      "TARGET_LANGUAGE=zh-CN",
    ].join("\n"));

    const config = loadConfigFromEnvFile(envPath, {});

    assert.equal(config.provider, "openai-compatible");
    assert.equal(config.openaiBaseUrl, "https://cf.ai-pixel.online/v1");
    assert.equal(config.openaiApiKey, "secret");
    assert.equal(config.openaiModel, "gpt-5.4-mini");
    assert.equal(config.openaiImageInputFormat, "image-field");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
