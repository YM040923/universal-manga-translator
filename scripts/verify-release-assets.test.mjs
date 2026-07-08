import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const verifier = path.join(root, "scripts", "verify-release-assets.ps1");

test("verify-release-assets accepts a valid release zip with matching checksum", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-release-assets-test-"));
  try {
    const { zipPath, shaPath, hash } = writeReleaseFixture(workspace);
    writeFileSync(shaPath, `${hash}  extension-release.zip\n`);

    const result = runVerifier(zipPath, shaPath);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Release assets verified/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-release-assets rejects a missing checksum file", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-release-assets-test-"));
  try {
    const { zipPath, shaPath } = writeReleaseFixture(workspace);

    const result = runVerifier(zipPath, shaPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Release checksum file not found/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-release-assets rejects a mismatched checksum", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-release-assets-test-"));
  try {
    const { zipPath, shaPath } = writeReleaseFixture(workspace);
    writeFileSync(shaPath, `${"0".repeat(64)}  extension-release.zip\n`);

    const result = runVerifier(zipPath, shaPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Release checksum mismatch/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function writeReleaseFixture(workspace) {
  const source = path.join(workspace, "dist");
  const iconDir = path.join(source, "icons");
  const zipPath = path.join(workspace, "extension-release.zip");
  const shaPath = path.join(workspace, "extension-release.zip.sha256");
  mkdirSync(iconDir, { recursive: true });
  writeCompleteMinimalExtension(source, iconDir);
  zipDirectory(source, zipPath);
  const hash = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
  return { zipPath, shaPath, hash };
}

function zipDirectory(source, zipPath) {
  const psSource = source.replaceAll("'", "''");
  const psZipPath = zipPath.replaceAll("'", "''");
  const command = [
    `$items = Get-ChildItem -LiteralPath '${psSource}' -Force`,
    `Compress-Archive -Path $items.FullName -DestinationPath '${psZipPath}' -Force`,
  ].join("; ");
  const result = spawnSync("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function runVerifier(zipPath, shaPath) {
  return spawnSync("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    verifier,
    "-ZipPath",
    zipPath,
    "-ShaPath",
    shaPath,
  ], { encoding: "utf8" });
}

function writeCompleteMinimalExtension(source, iconDir) {
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
  }));
  writeFileSync(path.join(source, "popup.html"), "<script src=\"popup.js\"></script>");
  writeFileSync(path.join(source, "popup.js"), "");
  writeFileSync(path.join(source, "content.js"), "");
  writeFileSync(path.join(source, "background.js"), "");
  writeFileSync(path.join(iconDir, "icon-16.png"), "png");
}
