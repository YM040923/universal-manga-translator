import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts", "write-release-build-info.ps1");

test("write-release-build-info writes version, commit, and zip checksum metadata", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-build-info-test-"));
  try {
    const zipPath = path.join(workspace, "extension-release.zip");
    const shaPath = path.join(workspace, "extension-release.zip.sha256");
    const outPath = path.join(workspace, "build-info.json");
    const content = "test release zip bytes";
    const hash = createHash("sha256").update(content).digest("hex");
    writeFileSync(zipPath, content);
    writeFileSync(shaPath, `${hash}  extension-release.zip\n`);

    const result = spawnSync("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-ZipPath",
      zipPath,
      "-ShaPath",
      shaPath,
      "-OutPath",
      outPath,
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const info = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(info.product, "Universal Manga Translator");
    assert.match(info.packageVersion, /^\d+\.\d+\.\d+$/);
    assert.match(info.extensionVersion, /^\d+\.\d+\.\d+$/);
    assert.match(info.commit, /^[0-9a-f]{40}$|^unknown$/);
    assert.equal(info.zipFile, "extension-release.zip");
    assert.equal(info.sha256, hash);
    assert.match(info.builtAtUtc, /^\d{4}-\d{2}-\d{2}T/);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
