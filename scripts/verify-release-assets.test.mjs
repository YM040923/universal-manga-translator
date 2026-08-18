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
    const { zipPath, shaPath, buildInfoPath, hash } = writeReleaseFixture(workspace);
    writeFileSync(shaPath, `${hash}  extension-release.zip\n`);
    writeBuildInfoFixture(buildInfoPath, { sha256: hash });

    const result = runVerifier(zipPath, shaPath, buildInfoPath);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Release assets verified/);
    assert.match(result.stdout, /build-info\.json/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-release-assets rejects a missing build metadata file", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-release-assets-test-"));
  try {
    const { zipPath, shaPath, buildInfoPath, hash } = writeReleaseFixture(workspace);
    writeFileSync(shaPath, `${hash}  extension-release.zip\n`);

    const result = runVerifier(zipPath, shaPath, buildInfoPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Release build metadata file not found/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-release-assets rejects a missing checksum file", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-release-assets-test-"));
  try {
    const { zipPath, shaPath, buildInfoPath } = writeReleaseFixture(workspace);

    const result = runVerifier(zipPath, shaPath, buildInfoPath);

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
    const { zipPath, shaPath, buildInfoPath, hash } = writeReleaseFixture(workspace);
    writeFileSync(shaPath, `${"0".repeat(64)}  extension-release.zip\n`);
    writeBuildInfoFixture(buildInfoPath, { sha256: hash });

    const result = runVerifier(zipPath, shaPath, buildInfoPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Release checksum mismatch/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-release-assets rejects a checksum file with a mismatched zip filename", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-release-assets-test-"));
  try {
    const { zipPath, shaPath, buildInfoPath, hash } = writeReleaseFixture(workspace);
    writeFileSync(shaPath, `${hash}  other.zip\n`);
    writeBuildInfoFixture(buildInfoPath, { sha256: hash });

    const result = runVerifier(zipPath, shaPath, buildInfoPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Release checksum filename mismatch/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-release-assets rejects build metadata with a mismatched checksum", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-release-assets-test-"));
  try {
    const { zipPath, shaPath, buildInfoPath, hash } = writeReleaseFixture(workspace);
    writeFileSync(shaPath, `${hash}  extension-release.zip\n`);
    writeBuildInfoFixture(buildInfoPath, { sha256: "1".repeat(64) });

    const result = runVerifier(zipPath, shaPath, buildInfoPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Release build metadata checksum mismatch/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-release-assets rejects build metadata with a mismatched zip filename", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-release-assets-test-"));
  try {
    const { zipPath, shaPath, buildInfoPath, hash } = writeReleaseFixture(workspace);
    writeFileSync(shaPath, `${hash}  extension-release.zip\n`);
    writeBuildInfoFixture(buildInfoPath, { sha256: hash, zipFile: "other.zip" });

    const result = runVerifier(zipPath, shaPath, buildInfoPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Release build metadata zip filename mismatch/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-release-assets rejects build metadata with mismatched versions", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-release-assets-test-"));
  try {
    const { zipPath, shaPath, buildInfoPath, hash } = writeReleaseFixture(workspace);
    writeFileSync(shaPath, `${hash}  extension-release.zip\n`);
    writeBuildInfoFixture(buildInfoPath, { sha256: hash, packageVersion: "9.9.9" });

    const result = runVerifier(zipPath, shaPath, buildInfoPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Release build metadata package version mismatch/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-release-assets rejects invalid build metadata JSON with a clear error", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-release-assets-test-"));
  try {
    const { zipPath, shaPath, buildInfoPath, hash } = writeReleaseFixture(workspace);
    writeFileSync(shaPath, `${hash}  extension-release.zip\n`);
    writeFileSync(buildInfoPath, "{ not json\n");

    const result = runVerifier(zipPath, shaPath, buildInfoPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Release build metadata is not valid JSON/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-release-assets rejects build metadata with missing required fields", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-release-assets-test-"));
  try {
    const { zipPath, shaPath, buildInfoPath, hash } = writeReleaseFixture(workspace);
    writeFileSync(shaPath, `${hash}  extension-release.zip\n`);
    writeBuildInfoFixture(buildInfoPath, { sha256: undefined });

    const result = runVerifier(zipPath, shaPath, buildInfoPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Release build metadata missing required field: sha256/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("verify-release-assets rejects build metadata with an invalid build timestamp", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-release-assets-test-"));
  try {
    const { zipPath, shaPath, buildInfoPath, hash } = writeReleaseFixture(workspace);
    writeFileSync(shaPath, `${hash}  extension-release.zip\n`);
    writeBuildInfoFixture(buildInfoPath, { sha256: hash, builtAtUtc: "not-a-date" });

    const result = runVerifier(zipPath, shaPath, buildInfoPath);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Release build metadata builtAtUtc must be an ISO UTC timestamp/);
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
  const buildInfoPath = path.join(workspace, "build-info.json");
  mkdirSync(iconDir, { recursive: true });
  writeCompleteMinimalExtension(source, iconDir);
  zipDirectory(source, zipPath);
  const hash = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
  return { zipPath, shaPath, buildInfoPath, hash };
}

function writeBuildInfoFixture(buildInfoPath, overrides = {}) {
  const packageVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  const extensionVersion = JSON.parse(readFileSync(path.join(root, "apps", "extension", "public", "manifest.json"), "utf8")).version;
  writeFileSync(buildInfoPath, `${JSON.stringify({
    zipFile: "extension-release.zip",
    sha256: "0".repeat(64),
    packageVersion,
    extensionVersion,
    product: "Universal Manga Translator",
    commit: "unknown",
    dirty: false,
    builtAtUtc: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }, null, 2)}\n`);
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

function runVerifier(zipPath, shaPath, buildInfoPath) {
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
    "-BuildInfoPath",
    buildInfoPath,
  ], { encoding: "utf8" });
}

function writeCompleteMinimalExtension(source, iconDir) {
  const extensionVersion = JSON.parse(readFileSync(path.join(root, "apps", "extension", "public", "manifest.json"), "utf8")).version;
  writeFileSync(path.join(source, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    name: "Test Extension",
    version: extensionVersion,
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
