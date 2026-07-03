import { dirname, resolve } from "node:path";

export interface ServerRuntimePaths {
  root: string;
  envPath: string;
  dataDir: string;
}

export function resolveServerRuntimePaths(mainFileUrlOrPath: string, env: NodeJS.ProcessEnv = process.env): ServerRuntimePaths {
  const explicitRoot = env.UMT_SERVER_ROOT?.trim();
  const root = explicitRoot ? resolve(explicitRoot) : resolve(dirname(fileUrlOrPathToPath(mainFileUrlOrPath)), "..");
  return {
    root,
    envPath: resolve(root, ".env"),
    dataDir: resolve(root, "data"),
  };
}

function fileUrlOrPathToPath(value: string): string {
  if (value.startsWith("file://")) return new URL(value).pathname.replace(/^\/(.:\/)/, "$1");
  return value;
}
