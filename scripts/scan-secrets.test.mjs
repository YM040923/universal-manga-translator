import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IGNORE_DIRECTIVE, listTrackedFiles, looksLikePlaceholder, main, maskSecret, scanFiles, scanText } from "./scan-secrets.mjs";

const root = resolve(import.meta.dirname, "..");
const secret = (prefix, body) => `${prefix}${body}`;

test("scanner flags credential-shaped values", () => {
  const cases = [
    [`key = "${secret("sk-", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4")}"`, "sk- style API key"],
    [`token: ${secret("ghp_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4o5p6q7r8")}`, "GitHub token"],
    [`id = ${secret("AKIA", "A1B2C3D4E5F6G7H8")}`, "AWS access key id"],
    [secret("-----BEGIN OPENSSH ", "PRIVATE KEY-----"), "private key block"],
    [`apiKey: "${secret("Zm9vYmFyYmF6cXV1eA", "3p9r7t1y3u5i7o9p1q3r")}"`, "secret assignment"],
  ];
  for (const [line, rule] of cases) {
    const findings = scanText(line, "fixture");
    assert.equal(findings.length, 1, `expected one finding for ${rule}, got ${findings.length}`);
    assert.equal(findings[0].rule, rule);
    assert.equal(findings[0].file, "fixture");
    assert.equal(findings[0].line, 1);
  }
});

test("scanner ignores placeholders and hyphenated identifiers", () => {
  for (const line of [
    'API Key=sk-...',
    'apiKey: "YOUR_API_KEY"',
    'apiKey: "{ocr_api_key}"',
    'apiKey: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
    'password: "changeme-please-rotate-1234"',
    'OPENAI_API_KEY: "example-openai-key"',
    'apiKey: "sk-abcdefghij1234567890example"',
    "const result = fakeResult(\"mask-opacity-independent-text\");",
    "const name = \"mask-scale-smaller-minimum\";",
  ]) {
    assert.deepEqual(scanText(line, "fixture"), [], `should not flag: ${line}`);
  }
});

test("ignore directive suppresses a line", () => {
  const value = secret("sk-", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4");
  assert.equal(scanText(`"${value}"`, "fixture").length, 1);
  assert.deepEqual(scanText(`"${value}" // ${IGNORE_DIRECTIVE}`, "fixture"), []);
});

test("findings never echo the full value", () => {
  const value = secret("sk-", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4");
  const [finding] = scanText(`"${value}"`, "fixture");
  assert.equal(finding.masked.includes(value.slice(5)), false);
  assert.match(finding.masked, /\*{6}/);
  assert.equal(maskSecret("short"), "*****");
  assert.equal(looksLikePlaceholder("<your-key>"), true);
});

test("the repository itself contains no credential-shaped strings", () => {
  const { findings, scanned } = scanFiles(listTrackedFiles(root), (path) => readFileSync(path, "utf8"));
  assert.equal(findings.length, 0, findings.map((f) => `${f.file}:${f.line} ${f.rule} ${f.masked}`).join("\n"));
  assert.ok(scanned > 100, `expected to scan the tracked sources, saw ${scanned} files`);
});

test("scanner self-test exits successfully", () => {
  assert.equal(main({ argv: ["--self-test"] }), 0);
});
