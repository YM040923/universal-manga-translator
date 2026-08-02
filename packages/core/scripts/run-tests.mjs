import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const coreRoot = path.resolve(import.meta.dirname, "..");
const distRoot = path.join(coreRoot, "dist");
const minimumTestCount = 78;
const testFiles = findTestFiles(distRoot);

if (testFiles.length === 0) {
  console.error(`Core test gate found no compiled test files under ${distRoot}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: coreRoot,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const testCount = readReportedTestCount(result.stdout ?? "");
if (testCount < minimumTestCount) {
  console.error(`Core test gate expected at least ${minimumTestCount} tests, but Node reported ${testCount}`);
  process.exit(1);
}
console.log(`CORE_TEST_COUNT=${testCount}`);

function findTestFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findTestFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".test.js")) files.push(absolute);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function readReportedTestCount(output) {
  const matches = [...output.matchAll(/^(?:#\s*)?(?:ℹ\s*)?tests\s+(\d+)\s*$/gmu)];
  return matches.length ? Math.max(...matches.map((match) => Number(match[1]))) : 0;
}
