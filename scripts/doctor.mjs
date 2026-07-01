import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function parseEnvText(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return env;
}

export function validateDoctorState(state) {
  const provider = state.env.VISION_PROVIDER || "mock";
  const checks = [
    { id: "provider", ok: provider === "mock" || provider === "openai-compatible", message: `VISION_PROVIDER=${provider}` },
    { id: "extension-built", ok: state.extensionBuilt, message: state.extensionBuilt ? "extension dist exists" : "run pnpm --filter @umt/extension build" },
    { id: "server-data", ok: state.serverDataDirExists, message: state.serverDataDirExists ? "server data dir exists or can be created" : "server data dir missing" },
  ];
  if (provider === "openai-compatible") {
    checks.push({ id: "openai-api-key", ok: Boolean(state.env.OPENAI_API_KEY), message: state.env.OPENAI_API_KEY ? "OPENAI_API_KEY is set" : "OPENAI_API_KEY is required for openai-compatible provider" });
  }
  return { ok: checks.every((check) => check.ok), checks };
}

export function readDoctorState(root = resolve(fileURLToPath(new URL("..", import.meta.url)))) {
  const envPath = resolve(root, ".env");
  const examplePath = resolve(root, ".env.example");
  const env = existsSync(envPath)
    ? parseEnvText(readFileSync(envPath, "utf8"))
    : existsSync(examplePath)
      ? parseEnvText(readFileSync(examplePath, "utf8"))
      : {};
  return {
    env,
    extensionBuilt: existsSync(resolve(root, "apps/extension/dist/manifest.json")) && existsSync(resolve(root, "apps/extension/dist/content.js")),
    serverDataDirExists: existsSync(resolve(root, "apps/server/data")) || true,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = validateDoctorState(readDoctorState());
  console.log("Universal Manga Translator doctor");
  for (const check of result.checks) {
    console.log(`${check.ok ? "OK" : "FAIL"} ${check.id}: ${check.message}`);
  }
  process.exitCode = result.ok ? 0 : 1;
}