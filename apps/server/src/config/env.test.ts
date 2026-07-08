import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeConfigPatch, loadConfigFromEnvFile, loadConfig, upsertConfigEnvText } from "./env.js";

test("loadConfigFromEnvFile reads generic network OCR config without printing secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-env-"));
  try {
    const envPath = join(dir, ".env");
    writeFileSync(envPath, [
      "TRANSLATION_PIPELINE=network-ocr-openai-compatible",
      "OPENAI_BASE_URL=https://api.example.com/v1",
      "OPENAI_API_KEY=secret",
      "OPENAI_MODEL=gpt-5.4-mini",
      "OCR_API_URL=https://ocr.example.test/api/v1/image/ocr",
      "OCR_API_KEYS=ocr-a,ocr-b",
      "OCR_INPUT_MODE=image_base64",
      "OCR_IMAGE_FIELD=image_base64",
      'OCR_STATIC_FIELDS_JSON={"need_location":true,"lang":"en"}',
      "OCR_REGIONS_PATHS=words_result,data.words_result",
      "OCR_TEXT_PATHS=words,text",
      "OCR_BOX_PATHS=location,box",
      "OCR_CONFIDENCE_PATHS=score,confidence",
      "TARGET_LANGUAGE=zh-CN",
    ].join("\n"));

    const config = loadConfigFromEnvFile(envPath, {});

    assert.equal(config.provider, "network-ocr-openai-compatible");
    assert.equal(config.openaiBaseUrl, "https://api.example.com/v1");
    assert.equal(config.openaiApiKey, "secret");
    assert.equal(config.openaiModel, "gpt-5.4-mini");
    assert.equal(config.ocrApiUrl, "https://ocr.example.test/api/v1/image/ocr");
    assert.deepEqual(config.ocrApiKeys, ["ocr-a", "ocr-b"]);
    assert.equal(config.ocrInputMode, "image_base64");
    assert.equal(config.ocrImageField, "image_base64");
    assert.deepEqual(config.ocrStaticFields, { need_location: true, lang: "en" });
    assert.deepEqual(config.ocrRegionsPaths, ["words_result", "data.words_result"]);
    assert.deepEqual(config.ocrTextPaths, ["words", "text"]);
    assert.deepEqual(config.ocrBoxPaths, ["location", "box"]);
    assert.deepEqual(config.ocrConfidencePaths, ["score", "confidence"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig parses generic OCR key pool", () => {
  const config = loadConfig({ OCR_API_KEYS: `pool-a, pool-b
pool-a` });

  assert.deepEqual(config.ocrApiKeys, ["pool-a", "pool-b"]);
});

test("loadConfig defaults to generic placeholders instead of a bundled OCR vendor", () => {
  const config = loadConfig({});

  assert.equal(config.openaiModel, "gpt-4.1-mini");
  assert.equal(config.ocrApiUrl, "https://example.com/ocr");
});

test("loadConfig migrates legacy UApi env names to the generic OCR path", () => {
  const config = loadConfig({
    VISION_PROVIDER: "uapis-ocr-openai-compatible",
    UAPIS_API_KEY: "legacy-uapi-key",
    UAPIS_OCR_URL: "https://legacy-ocr.example.test/api/v1/image/ocr",
    UAPIS_OCR_INPUT: "image_base64",
    UAPIS_OCR_NEED_LOCATION: "true",
    UAPIS_OCR_ENABLE_CLS: "false",
  });

  assert.equal(config.provider, "network-ocr-openai-compatible");
  assert.equal(config.ocrApiUrl, "https://legacy-ocr.example.test/api/v1/image/ocr");
  assert.deepEqual(config.ocrApiKeys, ["legacy-uapi-key"]);
  assert.equal(config.ocrInputMode, "image_base64");
  assert.equal(config.ocrImageField, "image_base64");
  assert.deepEqual(config.ocrStaticFields, { need_location: true, enable_cls: false, return_markdown: false });
});

test("mergeConfigPatch updates generic OCR API settings and key pool", () => {
  const current = loadConfigFromEnvFile("missing.env", {
    OPENAI_API_KEY: "existing-openai-key",
    OCR_API_KEYS: "old-a,old-b",
  });

  const updated = mergeConfigPatch(current, {
    provider: "network-ocr-openai-compatible",
    ocr: {
      apiUrl: "https://ocr.example.test/ocr",
      apiKeys: "new-a\nnew-b,new-a",
      inputMode: "file",
      imageField: "file",
      staticFields: { need_location: true },
      regionsPaths: ["data.words_result"],
      textPaths: ["text"],
      boxPaths: ["box"],
      confidencePaths: ["confidence"],
    },
  });

  assert.equal(updated.provider, "network-ocr-openai-compatible");
  assert.equal(updated.ocrApiUrl, "https://ocr.example.test/ocr");
  assert.deepEqual(updated.ocrApiKeys, ["new-a", "new-b"]);
  assert.equal(updated.ocrInputMode, "file");
  assert.equal(updated.ocrImageField, "file");
  assert.deepEqual(updated.ocrStaticFields, { need_location: true });
  assert.deepEqual(updated.ocrRegionsPaths, ["data.words_result"]);
  assert.deepEqual(updated.ocrTextPaths, ["text"]);
  assert.deepEqual(updated.ocrBoxPaths, ["box"]);
  assert.deepEqual(updated.ocrConfidencePaths, ["confidence"]);
});

test("mergeConfigPatch updates runtime model fields without requiring secrets", () => {
  const current = loadConfigFromEnvFile("missing.env", {
    VISION_PROVIDER: "network-ocr-openai-compatible",
    OPENAI_BASE_URL: "https://old.example/v1",
    OPENAI_API_KEY: "existing-openai-key",
    OPENAI_MODEL: "gpt-5.4-mini",
  });

  const updated = mergeConfigPatch(current, {
    targetLanguage: "zh-CN",
    openAICompatible: {
      baseUrl: "https://api.example.com/v1",
      model: "gpt-5.5",
    },
    image: { maxLongEdge: 1800, jpegQuality: 0.82 },
  });

  assert.equal(updated.provider, "network-ocr-openai-compatible");
  assert.equal(updated.targetLanguage, "zh-CN");
  assert.equal(updated.openaiBaseUrl, "https://api.example.com/v1");
  assert.equal(updated.openaiModel, "gpt-5.5");
  assert.equal(updated.openaiApiKey, "existing-openai-key");
  assert.equal(updated.maxImageLongEdge, 1800);
  assert.equal(updated.jpegQuality, 0.82);
});

test("upsertConfigEnvText writes generic OCR env keys and removes deprecated OCR provider keys", () => {
  const config = loadConfig({
    PORT: "47831",
    OPENAI_BASE_URL: "https://api.example.com/v1",
    OPENAI_API_KEY: "openai-secret",
    OPENAI_MODEL: "gpt-5.4-mini",
    OCR_API_URL: "https://ocr.example.test/ocr",
    OCR_API_KEYS: "ocr-a,ocr-b",
    OCR_STATIC_FIELDS_JSON: "{\"need_location\":true}",
  });

  const text = upsertConfigEnvText("UAPIS_API_KEY=old\nBAIDU_OCR_API_KEY=old\nLOCAL_OCR_URL=http://127.0.0.1:47832/ocr\n", config);

  assert.match(text, /TRANSLATION_PIPELINE=network-ocr-openai-compatible/);
  assert.doesNotMatch(text, /VISION_PROVIDER=/);
  assert.match(text, /OCR_API_URL=https:\/\/ocr\.example\.test\/ocr/);
  assert.match(text, /OCR_API_KEYS=ocr-a,ocr-b/);
  assert.match(text, /OPENAI_MODEL=gpt-5\.4-mini/);
  assert.doesNotMatch(text, /UAPIS_|BAIDU_|LOCAL_OCR/);
});

test("server runtime root can be redirected for portable desktop bundles", async () => {
  const { resolveServerRuntimePaths } = await import("../runtime/paths.js");
  const paths = resolveServerRuntimePaths("F:/PortableUMT/resources/server/dist/main.js", { UMT_SERVER_ROOT: "F:/PortableUMT/runtime" });

  assert.equal(paths.root, "F:\\PortableUMT\\runtime");
  assert.equal(paths.envPath, "F:\\PortableUMT\\runtime\\.env");
  assert.equal(paths.dataDir, "F:\\PortableUMT\\runtime\\data");
});
