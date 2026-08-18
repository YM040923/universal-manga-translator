import { spawn, execFile, type ChildProcess, type SpawnOptions } from "node:child_process";
import { cpSync, existsSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface OwnedProcess {
  kill: () => void;
  pid?: number;
}

export interface BackendHealth {
  ok: boolean;
  provider?: string;
  targetLanguage?: string;
}

export interface BackendStatus {
  running: boolean;
  owned: boolean;
  url: string;
  provider?: string;
  targetLanguage?: string;
}

export interface KillPortResult {
  killed: boolean;
  pids: number[];
}

export interface CleanupBackendResult extends KillPortResult {
  status: BackendStatus;
}

export interface BackendLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface BackendManagerDeps {
  backendUrl: string;
  fetchHealth?: (url: string) => Promise<BackendHealth>;
  spawnBackend?: () => OwnedProcess;
  killPortProcess?: (port: number) => Promise<KillPortResult>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  intervalMs?: number;
}

export interface StartBackendResult {
  started: boolean;
  status: BackendStatus;
}

export function portFromBackendUrl(backendUrl: string): number {
  return Number(new URL(backendUrl).port || (backendUrl.startsWith("https:") ? 443 : 80));
}

export function createBackendManager(deps: BackendManagerDeps) {
  let ownedBackend: OwnedProcess | undefined;
  let ownedBackendPid: number | undefined;
  const fetchHealth = deps.fetchHealth ?? defaultFetchHealth;

  async function getStatus(): Promise<BackendStatus> {
    const health = await fetchHealth(deps.backendUrl);
    const status: BackendStatus = {
      running: health.ok === true,
      owned: Boolean(ownedBackend),
      url: deps.backendUrl,
    };
    if (health.provider) status.provider = health.provider;
    if (health.targetLanguage) status.targetLanguage = health.targetLanguage;
    return status;
  }

  async function startBackend(): Promise<StartBackendResult> {
    const before = await getStatus();
    if (before.running) return { started: false, status: before };
    ownedBackend = (deps.spawnBackend ?? defaultSpawnBackend)();
    ownedBackendPid = ownedBackend.pid;
    const waitOptions: WaitForBackendReadyOptions = { fetchHealth: () => fetchHealth(deps.backendUrl) };
    if (deps.now) waitOptions.now = deps.now;
    if (deps.sleep) waitOptions.sleep = deps.sleep;
    if (typeof deps.timeoutMs === "number") waitOptions.timeoutMs = deps.timeoutMs;
    if (typeof deps.intervalMs === "number") waitOptions.intervalMs = deps.intervalMs;
    await waitForBackendReady(waitOptions);
    return { started: true, status: await getStatus() };
  }

  async function cleanupExistingBackend(): Promise<CleanupBackendResult> {
    stopOwnedBackend();
    const before = await getStatus();
    // Only kill the port when it is provably our backend (health check with a
    // provider string); never kill an unrelated process on that port.
    if (before.running) {
      const port = portFromBackendUrl(deps.backendUrl);
      const result = await (deps.killPortProcess ?? defaultKillPortProcess)(port);
      return { ...result, status: await getStatus() };
    }
    return { killed: false, pids: [], status: before };
  }

  function stopOwnedBackend(): boolean {
    if (!ownedBackend) return false;
    ownedBackend.kill();
    ownedBackend = undefined;
    ownedBackendPid = undefined;
    return true;
  }

  return { getStatus, startBackend, cleanupExistingBackend, stopOwnedBackend, getOwnedBackendPid: () => ownedBackendPid };
}

export interface WaitForBackendReadyOptions {
  fetchHealth: () => Promise<BackendHealth>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  intervalMs?: number;
}

export async function waitForBackendReady(options: WaitForBackendReadyOptions): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 500;
  const startedAt = now();
  let lastError: unknown;

  while (now() - startedAt <= timeoutMs) {
    try {
      const health = await options.fetchHealth();
      if (health.ok === true) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }

  const suffix = lastError instanceof Error ? `：${lastError.message}` : "";
  throw new Error(`后端启动超时，请检查端口或配置${suffix}`);
}

export async function defaultFetchHealth(backendUrl: string): Promise<BackendHealth> {
  try {
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}/health`, { cache: "no-store" });
    if (!response.ok) return { ok: false };
    const body = await response.json() as BackendHealth;
    // The UMT backend always reports a provider string; anything else on the
    // port is not our backend.
    const health: BackendHealth = { ok: body.ok === true && typeof body.provider === "string" };
    if (body.provider) health.provider = body.provider;
    if (body.targetLanguage) health.targetLanguage = body.targetLanguage;
    return health;
  } catch {
    return { ok: false };
  }
}

export function defaultBackendUrl(): string {
  return process.env.UMT_BACKEND_URL?.trim() || "http://127.0.0.1:47831";
}

export function findProjectRoot(startDir: string): string {
  let current = resolve(startDir);
  for (;;) {
    if (isProjectRoot(current)) return current;
    const parent = resolve(current, "..");
    if (parent === current) throw new Error("找不到 Universal Manga Translator 项目目录，无法启动后端");
    current = parent;
  }
}

export function findProjectRootFromCandidates(candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      return findProjectRoot(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("找不到 Universal Manga Translator 项目目录，无法启动后端");
}

function isProjectRoot(dir: string): boolean {
  return existsSync(resolve(dir, "pnpm-workspace.yaml")) && existsSync(resolve(dir, "apps", "server", "package.json"));
}

export function createBackendLaunchSpec(projectRoot: string, runtimeExecutable = process.env.UMT_NODE_EXE || "node"): BackendLaunchSpec {
  const root = resolve(projectRoot);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return {
    command: runtimeExecutable,
    args: [resolve(root, "apps", "server", "dist", "main.js")],
    cwd: root,
    env,
  };
}

export function createBundledBackendLaunchSpec(resourcesDir: string, runtimeExecutable = process.env.UMT_NODE_EXE || "node"): BackendLaunchSpec {
  const serverRoot = resolve(resourcesDir, "server");
  ensureBundledNodeModules(serverRoot);
  const env: NodeJS.ProcessEnv = { ...process.env, UMT_SERVER_ROOT: serverRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  return {
    command: runtimeExecutable,
    args: [resolve(serverRoot, "dist", "main.js")],
    cwd: serverRoot,
    env,
  };
}

export function ensureBundledNodeModules(serverRoot: string): void {
  const nodeModules = resolve(serverRoot, "node_modules");
  if (existsSync(nodeModules)) return;
  const packedModules = resolve(serverRoot, "_node_modules");
  if (!existsSync(packedModules)) return;
  try {
    symlinkSync(packedModules, nodeModules, "junction");
  } catch {
    cpSync(packedModules, nodeModules, { recursive: true });
  }
}
export function createBackendSpawnOptions(spec: BackendLaunchSpec): SpawnOptions {
  return {
    cwd: spec.cwd,
    env: spec.env,
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  };
}

export function defaultSpawnBackend(): OwnedProcess {
  const bundledResourcesDir = findBundledResourcesDir([
    process.resourcesPath,
    process.env.PORTABLE_EXECUTABLE_DIR ? resolve(process.env.PORTABLE_EXECUTABLE_DIR, "resources") : undefined,
    resolve(dirname(process.execPath), "resources"),
  ]);
  const spec = bundledResourcesDir
    ? createBundledBackendLaunchSpec(bundledResourcesDir)
    : createBackendLaunchSpec(findProjectRootFromCandidates([
      process.env.UMT_PROJECT_ROOT,
      process.env.PORTABLE_EXECUTABLE_DIR,
      dirname(process.execPath),
      process.cwd(),
      dirname(fileURLToPath(import.meta.url)),
    ]));
  const child: ChildProcess = spawn(spec.command, spec.args, createBackendSpawnOptions(spec));
  child.unref();
  return {
    ...(typeof child.pid === "number" ? { pid: child.pid } : {}),
    kill: () => {
      if (!child.killed) child.kill();
    },
  };
}

export async function defaultKillPortProcess(port: number): Promise<KillPortResult> {
  if (process.platform !== "win32") return { killed: false, pids: [] };
  const pids = await findListeningPids(port);
  for (const pid of pids) {
    await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `Stop-Process -Id ${pid} -Force`], { windowsHide: true });
  }
  return { killed: pids.length > 0, pids };
}

export async function findListeningPids(port: number): Promise<number[]> {
  try {
    const ps = `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique`;
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { windowsHide: true });
    const pids = parsePidLines(stdout);
    if (pids.length > 0) return pids;
  } catch {
    // Fall back to netstat below. Some Windows environments block Get-NetTCPConnection.
  }

  try {
    const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "tcp"], { windowsHide: true });
    return parseNetstatListeningPids(stdout, port);
  } catch {
    return [];
  }
}

function parsePidLines(stdout: string): number[] {
  return uniqueNumbers(stdout.split(/\r?\n/).map((line) => Number(line.trim())));
}

export function parseNetstatListeningPids(stdout: string, port: number): number[] {
  const pids: number[] = [];
  const portPattern = new RegExp(`(?:^|:|\\\\])${port}$`);
  for (const rawLine of stdout.split(/\r?\n/)) {
    const parts = rawLine.trim().split(/\s+/);
    if (parts.length < 5 || parts[0]?.toUpperCase() !== "TCP") continue;
    const localAddress = parts[1] ?? "";
    const state = parts[3] ?? "";
    const pid = Number(parts[4]);
    if (state.toUpperCase() !== "LISTENING") continue;
    if (!portPattern.test(localAddress)) continue;
    if (Number.isInteger(pid) && pid > 0) pids.push(pid);
  }
  return uniqueNumbers(pids);
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}


export function findBundledResourcesDir(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    const dir = resolve(candidate);
    if (existsSync(resolve(dir, "server", "dist", "main.js"))) return dir;
  }
  return undefined;
}

