import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
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
const script = path.join(root, "scripts", "write-extension-checksum.ps1");

test("write-extension-checksum writes lowercase sha256 for the release zip basename", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "umt-checksum-test-"));
  try {
    const zipPath = path.join(workspace, "extension-release.zip");
    const shaPath = path.join(workspace, "extension-release.zip.sha256");
    const content = "test release zip bytes";
    writeFileSync(zipPath, content);

    const result = spawnSync(shell, [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-ZipPath",
      zipPath,
      "-ShaPath",
      shaPath,
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const expected = createHash("sha256").update(content).digest("hex");
    assert.equal(readFileSync(shaPath, "utf8").trim(), `${expected}  extension-release.zip`);
  }
  finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
