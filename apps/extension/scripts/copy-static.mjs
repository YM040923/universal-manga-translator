import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const sourceRoot = resolve("public");
const targetRoot = resolve("dist");
removeStaleArtifacts(targetRoot);
copyDir(sourceRoot, targetRoot);

function copyDir(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    const sourcePath = join(source, entry);
    const targetPath = join(target, entry);
    if (statSync(sourcePath).isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else {
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
    }
  }
}

function removeStaleArtifacts(target) {
  rmSync(join(target, "options.html"), { force: true });
  rmSync(join(target, "options.js"), { force: true });
}