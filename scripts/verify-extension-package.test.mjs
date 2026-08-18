import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// GitHub Actions runs Windows PowerShell in Constrained Language Mode where
// Get-FileHash/Add-Type are unavailable; PowerShell 7 (pwsh) runs full language.
// Dev machines may lack pwsh, so fall back to Windows PowerShell.
function resolveShell() {
  for (const name of ["pwsh", "powershell"]) {
    const probe = spawnSync(name, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
    if (probe.status === 0) return name;
  }
  return "powershell";
}
const shell = resolveShell();

const root = path.resolve(import.meta.dirname, "..");
const verifier = path.join(root, "scripts", "verify-extension-package.ps1");

test("verify-extension-package rejects manifest referenced assets that are missing from the zip", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-package-test-"));
  try {
    const source = path.join(workspace, "dist");
    const iconDir = path.join(source, "icons");
    const zipPath = path.join(workspace, "extension.zip");
    mkdirSync(iconDir, { recursive: true });

    writeCompleteMinimalExtension(source, iconDir);
    rmSync(path.join(iconDir, "icon-16.png"), { force: true });

    zipDirectory(source, zipPath);
    const result = runVerifier(zipPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /missing manifest referenced asset icons\/icon-16\.png/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-extension-package accepts a complete minimal extension zip", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-package-test-"));
  try {
    const source = path.join(workspace, "dist");
    const iconDir = path.join(source, "icons");
    const zipPath = path.join(workspace, "extension.zip");
    mkdirSync(iconDir, { recursive: true });

    writeCompleteMinimalExtension(source, iconDir);

    zipDirectory(source, zipPath);
    const result = runVerifier(zipPath);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Extension package verified/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-extension-package rejects bundled secrets and provider-specific personal endpoints", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-package-test-"));
  try {
    const source = path.join(workspace, "dist");
    const iconDir = path.join(source, "icons");
    const zipPath = path.join(workspace, "extension.zip");
    mkdirSync(iconDir, { recursive: true });

    writeCompleteMinimalExtension(source, iconDir);
    writeFileSync(path.join(source, "popup.js"), "const provider = 'baidu';");

    zipDirectory(source, zipPath);
    const result = runVerifier(zipPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /forbidden packaged content/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-extension-package rejects options pages and static content scripts", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-package-test-"));
  try {
    const source = path.join(workspace, "dist");
    const iconDir = path.join(source, "icons");
    const zipPath = path.join(workspace, "extension.zip");
    mkdirSync(iconDir, { recursive: true });

    writeCompleteMinimalExtension(source, iconDir, {
      options_page: "options.html",
      content_scripts: [{ matches: ["<all_urls>"], js: ["content.js"] }],
    });
    writeFileSync(path.join(source, "options.html"), "");

    zipDirectory(source, zipPath);
    const result = runVerifier(zipPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /options pages are disabled/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function zipDirectory(source, zipPath) {
  const psSource = source.replaceAll("'", "''");
  const psZipPath = zipPath.replaceAll("'", "''");
  const command = [
    `$items = Get-ChildItem -LiteralPath '${psSource}' -Force`,
    `Compress-Archive -Path $items.FullName -DestinationPath '${psZipPath}' -Force`,
  ].join("; ");
  const result = spawnSync(shell, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function runVerifier(zipPath) {
  return spawnSync(shell, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    verifier,
    "-ZipPath",
    zipPath,
  ], { encoding: "utf8" });
}

function writeCompleteMinimalExtension(source, iconDir, extraManifest = {}) {
  writeFileSync(path.join(source, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    name: "Test Extension",
    version: "0.0.0",
    icons: {
      16: "icons/icon-16.png",
    },
    action: {
      default_popup: "popup.html",
      default_icon: {
        16: "icons/icon-16.png",
      },
    },
    background: {
      service_worker: "background.js",
    },
    ...extraManifest,
  }));
  writeFileSync(path.join(source, "popup.html"), "<script src=\"popup.js\"></script>");
  writeFileSync(path.join(source, "popup.js"), "");
  writeFileSync(path.join(source, "content.js"), "");
  writeFileSync(path.join(source, "background.js"), "");
  writeFileSync(path.join(iconDir, "icon-16.png"), "png");
}
