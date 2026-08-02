import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const coreRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(coreRoot, "src");
const distRoot = path.join(coreRoot, "dist");
const sourceTestFiles = findTestFiles(srcRoot, ".test.ts");

if (sourceTestFiles.length === 0) {
  console.error(`Core test gate found no source test files under ${srcRoot}`);
  process.exit(1);
}

const testFiles = sourceTestFiles.map((sourceFile) => {
  const relative = path.relative(srcRoot, sourceFile).replace(/\.ts$/u, ".js");
  return path.join(distRoot, relative);
});
const missingTestFiles = testFiles.filter((testFile) => !existsSync(testFile));
if (missingTestFiles.length > 0) {
  console.error("Core test gate is missing compiled suites:");
  for (const testFile of missingTestFiles) console.error(`- ${path.relative(coreRoot, testFile)}`);
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
if (testCount <= 0) {
  console.error("Core test gate expected Node to report at least one executed test");
  process.exit(1);
}
console.log(`CORE_TEST_SUITE_COUNT=${sourceTestFiles.length}`);
console.log(`CORE_TEST_COUNT=${testCount}`);

function findTestFiles(directory, suffix) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findTestFiles(absolute, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(absolute);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function readReportedTestCount(output) {
  const matches = [...output.matchAll(/^(?:#\s*)?(?:ℹ\s*)?tests\s+(\d+)\s*$/gmu)];
  return matches.length ? Math.max(...matches.map((match) => Number(match[1]))) : 0;
}
