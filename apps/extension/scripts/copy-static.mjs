import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
const target = resolve("dist/manifest.json");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(resolve("public/manifest.json"), target);
