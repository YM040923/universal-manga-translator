#!/usr/bin/env node
// Scans tracked files for credential-shaped strings: this project asks people to paste OCR /
// translation API keys into issues and config dumps, so CI fails on a hit instead of trusting
// a reviewer to spot one. Values are masked in output so the report cannot leak them either.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SECRET_RULES = [
  { name: "sk- style API key", pattern: /(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]{20,}/g },
  { name: "AWS access key id", pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{36,}\b/g },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "Stripe key", pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b|\bpk_live_[A-Za-z0-9]{16,}\b/g },
  { name: "private key block", pattern: /-----BEGIN (?:[A-Z][A-Z ]{0,20})?PRIVATE KEY-----/g },
  { name: "npm registry auth token", pattern: /_authToken\s*=\s*[^\s"'`]{12,}/g },
  { name: "secret assignment", pattern: /(?:api[_-]?key|access[_-]?token|client[_-]?secret|secret|password|passwd)["']?\s*[:=]\s*["'][^"'\n]{16,}["']/gi },
];

export const IGNORE_DIRECTIVE = "scan-secrets:ignore";

const PLACEHOLDER_VALUE = /^(?:x+|\*+|\.+|-+|_+|\{[^{}]{0,60}\}|\$\{[^{}]{0,60}\}|<[^<>]{0,60}>)$/i;
const PLACEHOLDER_WORDS = /change[-_]?me|your[-_]?(?:api[-_]?key|key)|placeholder|example|sample|dummy|fake|notareal|redacted|replace[-_]?me|insert[-_]?here/i;

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf",
  ".zip", ".gz", ".tgz", ".br", ".pdf", ".mp3", ".mp4", ".webm", ".exe", ".node", ".wasm",
]);

function extractValue(match) {
  const quoted = match.match(/["']([^"']+)["']/);
  if (quoted) return quoted[1];
  const assignment = match.match(/[=:]\s*([^\s"'`]+)$/);
  return assignment ? assignment[1] : match;
}

export function looksLikePlaceholder(value) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_VALUE.test(trimmed)) return true;
  if (PLACEHOLDER_WORDS.test(trimmed)) return true;
  const alphabet = new Set(trimmed.replaceAll(/[^A-Za-z0-9]/g, "").toLowerCase());
  return alphabet.size > 0 && alphabet.size <= 2;
}

export function maskSecret(value) {
  const chars = [...value];
  if (chars.length <= 8) return "*".repeat(chars.length);
  return `${chars.slice(0, 4).join("")}${"*".repeat(6)}${chars.slice(-3).join("")}`;
}

export function scanText(text, fileName = "<text>") {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.includes(IGNORE_DIRECTIVE)) continue;
    for (const rule of SECRET_RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of line.matchAll(rule.pattern)) {
        const value = extractValue(match[0]);
        if (looksLikePlaceholder(value)) continue;
        findings.push({ file: fileName, line: index + 1, rule: rule.name, masked: maskSecret(value) });
      }
    }
  }
  return findings;
}

export function listTrackedFiles(cwd = process.cwd()) {
  return execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
    .split("\0")
    .filter((entry) => entry.length > 0)
    .map((entry) => resolve(cwd, entry));
}

export function scanFiles(paths, readFile = (path) => readFileSync(path, "utf8")) {
  const findings = [];
  const missing = [];
  let scanned = 0;
  for (const path of paths) {
    if (BINARY_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    let text;
    try {
      text = readFile(path);
    } catch (error) {
      // Tracked files deleted but not yet committed are absent from disk; CI checkouts never
      // hit this, and failing here would hide every other finding behind a read error.
      if (error?.code === "ENOENT") missing.push(path);
      else throw error;
      continue;
    }
    if (text.includes("\0")) continue;
    scanned += 1;
    findings.push(...scanText(text, path));
  }
  return { findings, scanned, missing };
}

export function main({ cwd = process.cwd(), argv = [] } = {}) {
  if (argv.includes("--self-test")) {
    const hits = scanText(`api = "${"sk-"}${"A".repeat(24)}"`);
    if (hits.length !== 1) {
      console.error("Self-test failed: the scanner does not detect a synthetic key.");
      return 1;
    }
    console.log(`Secret scanner self-test ok (${hits[0].rule}, masked as ${hits[0].masked}).`);
    return 0;
  }

  const { findings, scanned, missing } = scanFiles(listTrackedFiles(cwd));
  const shown = (path) => relative(cwd, path) || path;
  if (missing.length > 0) {
    console.warn(`Skipped ${missing.length} tracked file(s) missing from disk: ${missing.map(shown).join(", ")}`);
  }
  if (findings.length === 0) {
    console.log(`No credential-shaped strings in ${scanned} tracked text files.`);
    return 0;
  }
  console.error(`Found ${findings.length} possible secret(s). Rotate the value first, then remove it from the repo.`);
  for (const finding of findings) {
    console.error(`  ${shown(finding.file)}:${finding.line}  ${finding.rule}  ${finding.masked}`);
  }
  console.error(`Use the ${IGNORE_DIRECTIVE} line comment only for a value that is provably fake.`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main({ argv: process.argv.slice(2) });
}
