import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|html|css|yaml|yml|txt|ps1)$/;

/**
 * Writing a source file through a shell that defaults to the system codepage turns every CJK
 * string into U+FFFD while the file still parses, so the popup ships boxes instead of labels.
 */
test("tracked text files contain no replacement characters", () => {
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .filter((file) => TEXT_EXT.test(file));
  const damaged = files.filter((file) => readFileSync(file, "utf8").includes("\uFFFD"));

  assert.deepEqual(damaged, []);
});
