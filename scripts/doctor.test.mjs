import test from "node:test";
import assert from "node:assert/strict";
import { parseEnvText, validateDoctorState } from "./doctor.mjs";

test("parseEnvText parses simple dotenv files", () => {
  assert.deepEqual(parseEnvText(`PORT=47831
VISION_PROVIDER=network-ocr-openai-compatible
TRANSLATION_PIPELINE=network-ocr-openai-compatible
# ignored
OPENAI_API_KEY=abc=123
`), {
    PORT: "47831",
    VISION_PROVIDER: "network-ocr-openai-compatible",
    TRANSLATION_PIPELINE: "network-ocr-openai-compatible",
    OPENAI_API_KEY: "abc=123",
  });
});

test("validateDoctorState checks generic network OCR and translator keys", () => {
  const missing = validateDoctorState({ env: { TRANSLATION_PIPELINE: "network-ocr-openai-compatible" }, extensionBuilt: true, serverDataDirExists: true });
  assert.equal(missing.ok, false);
  assert.equal(missing.checks.some((check) => check.id === "openai-api-key" && !check.ok), true);
  assert.equal(missing.checks.some((check) => check.id === "ocr-api-keys" && !check.ok), true);
  assert.equal(missing.checks.some((check) => check.id === "baidu-ocr-api-key"), false);
  assert.equal(missing.checks.some((check) => check.id === "local-ocr-url"), false);

  const configured = validateDoctorState({
    env: {
      TRANSLATION_PIPELINE: "network-ocr-openai-compatible",
      OPENAI_API_KEY: "translator-key",
      OCR_API_KEYS: "ocr-key-a,ocr-key-b",
      OCR_API_URL: "https://ocr.example.test/ocr",
    },
    extensionBuilt: true,
    serverDataDirExists: true,
  });
  assert.equal(configured.ok, true);
  assert.equal(configured.checks.some((check) => check.id === "ocr-api-url" && check.ok), true);
});

test("validateDoctorState rejects legacy product providers", () => {
  for (const provider of ["mock", "openai-compatible", "baidu-ocr-openai-compatible", "local-ocr-openai-compatible", "uapis-ocr-openai-compatible"]) {
    const result = validateDoctorState({ env: { TRANSLATION_PIPELINE: provider, OPENAI_API_KEY: "x", OCR_API_KEYS: "y" }, extensionBuilt: true, serverDataDirExists: true });
    assert.equal(result.checks.find((check) => check.id === "provider")?.ok, false, provider);
  }
});

test("validateDoctorState accepts legacy VISION_PROVIDER only as read compatibility", () => {
  const result = validateDoctorState({
    env: {
      VISION_PROVIDER: "network-ocr-openai-compatible",
      OPENAI_API_KEY: "x",
      OCR_API_KEYS: "y",
      OCR_API_URL: "https://ocr.example.test/ocr",
    },
    extensionBuilt: true,
    serverDataDirExists: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.checks.find((check) => check.id === "provider")?.message, "TRANSLATION_PIPELINE=network-ocr-openai-compatible");
});
