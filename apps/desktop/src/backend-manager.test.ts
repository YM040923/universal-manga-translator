import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createBackendLaunchSpec, createBundledBackendLaunchSpec, createBackendManager, createBackendSpawnOptions, findBundledResourcesDir, findProjectRoot, findProjectRootFromCandidates, parseNetstatListeningPids, waitForBackendReady } from "./backend-manager.js";

function makeFakeProjectRoot(): { root: string; nested: string } {
  const root = mkdtempSync(join(tmpdir(), "umt-root-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  mkdirSync(join(root, "apps", "server"), { recursive: true });
  writeFileSync(join(root, "apps", "server", "package.json"), "{}");
  const nested = join(root, "apps", "desktop", "dist-app", "win-unpacked", "resources", "app", "dist");
  mkdirSync(nested, { recursive: true });
  return { root, nested };
}

test("findProjectRoot walks upward until pnpm-workspace.yaml is found", () => {
  const { root, nested } = makeFakeProjectRoot();
  assert.equal(findProjectRoot(nested), resolve(root));
});

test("findProjectRootFromCandidates supports packaged portable exe directory", () => {
  const { root } = makeFakeProjectRoot();
  const portableDir = join(root, "apps", "desktop", "dist-app");
  assert.equal(findProjectRootFromCandidates([undefined, portableDir]), resolve(root));
});


test("backend launch spec uses system Node as hidden runtime instead of pnpm or Electron", () => {
  const { root } = makeFakeProjectRoot();
  const spec = createBackendLaunchSpec(root, "C:/Program Files/nodejs/node.exe");
  assert.equal(spec.command, "C:/Program Files/nodejs/node.exe");
  assert.deepEqual(spec.args, [resolve(root, "apps", "server", "dist", "main.js")]);
  assert.equal(spec.cwd, resolve(root));
  assert.equal(spec.env.ELECTRON_RUN_AS_NODE, undefined);
});

test("backend spawn options detach the backend so it can keep running after desktop closes", () => {
  const { root } = makeFakeProjectRoot();
  const spec = createBackendLaunchSpec(root, "node");
  const options = createBackendSpawnOptions(spec);

  assert.equal(options.cwd, resolve(root));
  assert.equal(options.detached, true);
  assert.equal(options.stdio, "ignore");
  assert.equal(options.windowsHide, true);
  assert.equal(options.env?.ELECTRON_RUN_AS_NODE, undefined);
});

test("backend manager reads status without starting backend", async () => {
  const manager = createBackendManager({
    backendUrl: "http://127.0.0.1:47831",
    fetchHealth: async () => ({ ok: false }),
    spawnBackend: () => { throw new Error("status must not spawn"); },
    sleep: async () => undefined,
  });

  assert.deepEqual(await manager.getStatus(), {
    running: false,
    owned: false,
    url: "http://127.0.0.1:47831",
  });
});

test("backend manager reuses an already healthy backend when starting", async () => {
  const calls: string[] = [];
  const manager = createBackendManager({
    backendUrl: "http://127.0.0.1:47831",
    fetchHealth: async () => ({ ok: true, provider: "mock", targetLanguage: "zh-CN" }),
    spawnBackend: () => {
      calls.push("spawn");
      throw new Error("should not spawn");
    },
    now: () => 0,
    sleep: async () => undefined,
  });

  const result = await manager.startBackend();

  assert.equal(result.started, false);
  assert.equal(result.status.running, true);
  assert.equal(result.status.owned, false);
  assert.equal(result.status.provider, "mock");
  assert.deepEqual(calls, []);
});

test("backend manager starts backend hidden when health check fails", async () => {
  const calls: string[] = [];
  let attempts = 0;
  const manager = createBackendManager({
    backendUrl: "http://127.0.0.1:47831",
    fetchHealth: async () => ++attempts >= 2 ? ({ ok: true, provider: "mock" }) : ({ ok: false }),
    spawnBackend: () => {
      calls.push("spawn");
      return { kill: () => calls.push("kill") };
    },
    now: () => attempts * 100,
    sleep: async () => undefined,
  });

  const result = await manager.startBackend();
  const stopped = manager.stopOwnedBackend();

  assert.equal(result.started, true);
  assert.equal(result.status.running, true);
  assert.equal(result.status.owned, true);
  assert.equal(stopped, true);
  assert.deepEqual(calls, ["spawn", "kill"]);
});

test("cleanupExistingBackend kills the process listening on the configured port", async () => {
  const calls: string[] = [];
  let running = true;
  const manager = createBackendManager({
    backendUrl: "http://127.0.0.1:47831",
    fetchHealth: async () => ({ ok: running }),
    killPortProcess: async (port: number) => {
      calls.push(`kill:${port}`);
      running = false;
      return { killed: true, pids: [1234] };
    },
    sleep: async () => undefined,
  });

  const result = await manager.cleanupExistingBackend();

  assert.deepEqual(calls, ["kill:47831"]);
  assert.equal(result.killed, true);
  assert.deepEqual(result.pids, [1234]);
  assert.equal(result.status.running, false);
});

test("parseNetstatListeningPids reads only listening rows for the requested port", () => {
  const output = [
    "  TCP    127.0.0.1:47831        0.0.0.0:0              LISTENING       1111",
    "  TCP    127.0.0.1:47832        0.0.0.0:0              LISTENING       2222",
    "  TCP    0.0.0.0:47831          1.2.3.4:5555           ESTABLISHED     3333",
    "  TCP    [::1]:47831            [::]:0                 LISTENING       4444",
  ].join("\n");

  assert.deepEqual(parseNetstatListeningPids(output, 47831), [1111, 4444]);
});

test("waitForBackendReady times out with a clear error", async () => {
  await assert.rejects(
    waitForBackendReady({
      fetchHealth: async () => ({ ok: false }),
      now: (() => {
        let time = 0;
        return () => (time += 250);
      })(),
      sleep: async () => undefined,
      timeoutMs: 500,
      intervalMs: 100,
    }),
    /后端启动超时，请检查端口或配置/,
  );
});

test("findProjectRootFromCandidates reports a readable Chinese error when project root is missing", () => {
  assert.throws(
    () => findProjectRootFromCandidates([join(tmpdir(), "definitely-not-umt")]),
    /找不到 Universal Manga Translator 项目目录，无法启动后端/,
  );
});

test("backend status does not expose legacy admin url", async () => {
  const manager = createBackendManager({
    backendUrl: "http://127.0.0.1:47831",
    fetchHealth: async () => ({ ok: false }),
    sleep: async () => undefined,
  });

  assert.deepEqual(await manager.getStatus(), {
    running: false,
    owned: false,
    url: "http://127.0.0.1:47831",
  });
});


test("backend launch spec can start bundled portable server without a source project root", () => {
  const spec = createBundledBackendLaunchSpec("F:/PortableUMT/resources", "C:/Program Files/nodejs/node.exe");

  assert.equal(spec.command, "C:/Program Files/nodejs/node.exe");
  assert.deepEqual(spec.args, [resolve("F:/PortableUMT/resources/server/dist/main.js")]);
  assert.equal(spec.cwd, resolve("F:/PortableUMT/resources/server"));
  assert.equal(spec.env.UMT_SERVER_ROOT, resolve("F:/PortableUMT/resources/server"));
  assert.equal(spec.env.ELECTRON_RUN_AS_NODE, undefined);
});

test("packaged desktop detects bundled server resources before falling back to source project root", () => {
  const resources = mkdtempSync(join(tmpdir(), "umt-resources-"));
  mkdirSync(join(resources, "server", "dist"), { recursive: true });
  writeFileSync(join(resources, "server", "dist", "main.js"), "console.log('server')");

  assert.equal(findBundledResourcesDir([undefined, resources]), resolve(resources));
});

test("bundled launch spec materializes packaged runtime modules for Node resolution", () => {
  const resources = mkdtempSync(join(tmpdir(), "umt-resources-"));
  mkdirSync(join(resources, "server", "dist"), { recursive: true });
  mkdirSync(join(resources, "server", "_node_modules", "fastify"), { recursive: true });
  writeFileSync(join(resources, "server", "dist", "main.js"), "console.log('server')");
  writeFileSync(join(resources, "server", "_node_modules", "fastify", "package.json"), "{}");

  createBundledBackendLaunchSpec(resources, "node");

  assert.equal(existsSync(join(resources, "server", "node_modules", "fastify", "package.json")), true);
});

