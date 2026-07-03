import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const prepared = resolve(import.meta.dirname, "../dist-server");
const serverDist = resolve(root, "apps/server/dist");
const serverPackage = resolve(root, "apps/server/package.json");
const serverRoot = resolve(root, "apps/server");
const envExample = resolve(root, ".env.example");
const runtimeIgnoredDeps = new Set(["tsx"]);
const copiedPackages = new Set();

if (!existsSync(serverDist)) throw new Error(`Server dist not found: ${serverDist}. Run pnpm --filter @umt/server build first.`);
if (!existsSync(resolve(serverRoot, "node_modules"))) throw new Error(`Server node_modules not found. Run pnpm install first.`);

rmSync(prepared, { recursive: true, force: true });
mkdirSync(prepared, { recursive: true });
cpSync(serverDist, resolve(prepared, "dist"), { recursive: true });
copyFileSync(serverPackage, resolve(prepared, "package.json"));
if (existsSync(envExample)) copyFileSync(envExample, resolve(prepared, ".env.example"));
mkdirSync(resolve(prepared, "data"), { recursive: true });
copyRuntimeDependencies();
removeBuildNoise(resolve(prepared, "dist"));
console.log(`Prepared bundled backend server: ${prepared}`);

function copyRuntimeDependencies() {
  const targetNodeModules = resolve(prepared, "_node_modules");
  mkdirSync(targetNodeModules, { recursive: true });
  const pkg = readJson(serverPackage);
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (runtimeIgnoredDeps.has(name)) continue;
    copyPackageByName(name, serverRoot, targetNodeModules, false);
  }
  removeBuildNoise(targetNodeModules);
}

function copyPackageByName(name, fromDir, targetNodeModules, optional) {
  if (runtimeIgnoredDeps.has(name) || copiedPackages.has(name)) return;
  if (name === "@umt/shared") {
    copyWorkspaceSharedPackage(targetNodeModules);
    copiedPackages.add(name);
    return;
  }

  let packageJsonPath;
  try {
    packageJsonPath = resolveDependencyPackageJson(name, fromDir);
  } catch (error) {
    if (optional) return;
    throw error;
  }

  const packageRoot = dirname(packageJsonPath);
  copyMaterialized(packageRoot, resolvePackageTarget(targetNodeModules, name));
  copiedPackages.add(name);

  const pkg = readJson(packageJsonPath);
  for (const depName of Object.keys(pkg.dependencies ?? {})) copyPackageByName(depName, packageRoot, targetNodeModules, false);
  for (const depName of Object.keys(pkg.optionalDependencies ?? {})) copyPackageByName(depName, packageRoot, targetNodeModules, true);
  for (const depName of Object.keys(pkg.peerDependencies ?? {})) {
    const peerMeta = pkg.peerDependenciesMeta?.[depName];
    copyPackageByName(depName, packageRoot, targetNodeModules, peerMeta?.optional === true);
  }
}

function resolveDependencyPackageJson(name, fromDir) {
  let current = resolve(fromDir);
  for (;;) {
    const candidate = resolve(current, "node_modules", ...name.split("/"), "package.json");
    if (existsSync(candidate)) return realpathSync(candidate);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Cannot resolve runtime dependency ${name} from ${fromDir}`);
}

function resolvePackageTarget(targetNodeModules, name) {
  return resolve(targetNodeModules, ...name.split("/"));
}

function copyMaterialized(sourcePath, targetPath) {
  const realSource = lstatSync(sourcePath).isSymbolicLink() ? realpathSync(sourcePath) : sourcePath;
  rmSync(targetPath, { recursive: true, force: true });
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(realSource, targetPath, { recursive: true, dereference: true });
}

function copyWorkspaceSharedPackage(targetNodeModules) {
  const sharedDist = resolve(root, "packages/shared/dist");
  if (!existsSync(sharedDist)) throw new Error(`Shared package dist not found: ${sharedDist}. Run pnpm --filter @umt/shared build first.`);
  const targetShared = resolve(targetNodeModules, "@umt/shared");
  rmSync(targetShared, { recursive: true, force: true });
  mkdirSync(targetShared, { recursive: true });
  cpSync(sharedDist, resolve(targetShared, "dist"), { recursive: true });
  copyFileSync(resolve(root, "packages/shared/package.json"), resolve(targetShared, "package.json"));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function removeBuildNoise(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (["test", "tests", "docs", "doc", "example", "examples", "benchmark", "benchmarks", ".github", ".cache", ".nyc_output"].includes(entry.name)) {
        rmSync(path, { recursive: true, force: true });
      } else {
        removeBuildNoise(path);
      }
      continue;
    }
    if (/\.test\.(js|cjs|mjs|d\.ts|js\.map)$/.test(entry.name) || /\.(d\.ts|js\.map|tsbuildinfo)$/.test(entry.name)) rmSync(path, { force: true });
  }
}
