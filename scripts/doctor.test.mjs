import test from "node:test";
import assert from "node:assert/strict";
import { parseEnvText, validateDoctorState } from "./doctor.mjs";

test("parseEnvText parses simple dotenv files", () => {
  assert.deepEqual(parseEnvText("PORT=47831\nVISION_PROVIDER=mock\n# ignored\nOPENAI_API_KEY=abc=123\n"), {
    PORT: "47831",
    VISION_PROVIDER: "mock",
    OPENAI_API_KEY: "abc=123",
  });
});

test("validateDoctorState accepts mock provider without api key", () => {
  const result = validateDoctorState({ env: { VISION_PROVIDER: "mock" }, extensionBuilt: true, serverDataDirExists: true });
  assert.equal(result.ok, true);
  assert.equal(result.checks.every((check) => check.ok), true);
});

test("validateDoctorState warns when OpenAI provider has no api key", () => {
  const result = validateDoctorState({ env: { VISION_PROVIDER: "openai-compatible" }, extensionBuilt: true, serverDataDirExists: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.some((check) => check.id === "openai-api-key" && !check.ok), true);
});