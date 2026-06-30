# Universal Manga Translator MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable MVP vertical slice: a Chrome extension detects generic manga images, submits them to a localhost backend, receives translated overlay regions, and renders them over the page.

**Architecture:** Use a TypeScript monorepo with three units: `@umt/shared` for protocol/types/helpers, `@umt/server` for Fastify + provider + cache/queue, and `@umt/extension` for Manifest V3 content UI, detector, scheduler, capture, and overlay rendering. The MVP uses a deterministic mock provider for reliable tests and an OpenAI-compatible provider behind the same interface for real use.

**Tech Stack:** TypeScript, pnpm workspaces, Vite, Chrome MV3, Fastify, sharp, better-sqlite3, Vitest, Playwright.

---

## Scope Boundary

This plan intentionally builds a strong vertical slice, not the full final product. It includes:

- monorepo scaffold;
- shared protocol and geometry;
- backend health and submit API;
- mock provider;
- OpenAI-compatible provider boundary;
- generic `<img>` detector;
- viewport priority scheduling;
- overlay renderer;
- basic floating panel;
- manual text edit MVP;
- fixture-based smoke verification.

It defers these into follow-up plans:

- real backend image URL download with request headers;
- persistent SQLite use inside the submit API;
- WebSocket client status in the extension;
- full canvas/background-image capture;
- true manual region crop/submit flow;
- Google Vision OCR;
- local OCR;
- three real-site E2E matrix.

## Task 1: Workspace Scaffold

**Files:**
- Create: `F:\meihua\universal-manga-translator\package.json`
- Create: `F:\meihua\universal-manga-translator\pnpm-workspace.yaml`
- Create: `F:\meihua\universal-manga-translator\tsconfig.base.json`
- Create: `F:\meihua\universal-manga-translator\.gitignore`
- Create: `F:\meihua\universal-manga-translator\.env.example`
- Modify: `F:\meihua\universal-manga-translator\README.md`

- [ ] **Step 1: Create root package file**

Create `F:\meihua\universal-manga-translator\package.json`:

```json
{
  "name": "universal-manga-translator",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "dev:server": "pnpm --filter @umt/server dev",
    "dev:extension": "pnpm --filter @umt/extension dev",
    "test:e2e": "playwright test tests/integration"
  },
  "devDependencies": {
    "@playwright/test": "^1.45.0",
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create workspace and TypeScript configuration**

Create `F:\meihua\universal-manga-translator\pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `F:\meihua\universal-manga-translator\tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Create ignore and environment files**

Create `F:\meihua\universal-manga-translator\.gitignore`:

```gitignore
node_modules/
dist/
.env
apps/server/data/
coverage/
.playwright/
test-results/
```

Create `F:\meihua\universal-manga-translator\.env.example`:

```text
PORT=47831
VISION_PROVIDER=mock
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
TARGET_LANGUAGE=zh-CN
MAX_IMAGE_LONG_EDGE=1600
JPEG_QUALITY=0.75
```

- [ ] **Step 4: Update README with development commands**

Append to `F:\meihua\universal-manga-translator\README.md`:

```markdown

## Development

```powershell
pnpm install
pnpm dev:server
pnpm dev:extension
```

The backend listens on `http://127.0.0.1:47831` by default.
```

- [ ] **Step 5: Install dependencies**

Run:

```powershell
pnpm install
```

Expected: command succeeds and creates `F:\meihua\universal-manga-translator\pnpm-lock.yaml`.

- [ ] **Step 6: Commit scaffold**

Run:

```powershell
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .env.example README.md pnpm-lock.yaml
git commit -m "chore: scaffold universal manga translator workspace"
```

Expected: commit succeeds.

---

## Task 2: Shared Package

**Files:**
- Create: `F:\meihua\universal-manga-translator\packages\shared\package.json`
- Create: `F:\meihua\universal-manga-translator\packages\shared\tsconfig.json`
- Create: `F:\meihua\universal-manga-translator\packages\shared\src\types.ts`
- Create: `F:\meihua\universal-manga-translator\packages\shared\src\protocol.ts`
- Create: `F:\meihua\universal-manga-translator\packages\shared\src\geometry.ts`
- Create: `F:\meihua\universal-manga-translator\packages\shared\src\hashing.ts`
- Create: `F:\meihua\universal-manga-translator\packages\shared\src\index.ts`
- Create: `F:\meihua\universal-manga-translator\packages\shared\src\geometry.test.ts`
- Create: `F:\meihua\universal-manga-translator\packages\shared\src\hashing.test.ts`

- [ ] **Step 1: Create shared package metadata**

Create `F:\meihua\universal-manga-translator\packages\shared\package.json`:

```json
{
  "name": "@umt/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run src/*.test.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Create `F:\meihua\universal-manga-translator\packages\shared\tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Write failing shared tests**

Create `F:\meihua\universal-manga-translator\packages\shared\src\geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapNaturalBoxToRenderedBox, visibleRatio } from "./geometry";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe("geometry helpers", () => {
  it("maps natural image coordinates into rendered coordinates", () => {
    expect(
      mapNaturalBoxToRenderedBox(rect(100, 200, 300, 400), { width: 1000, height: 2000 }, rect(10, 20, 500, 1000)),
    ).toEqual(rect(60, 120, 150, 200));
  });

  it("computes visible ratio for a partially visible rectangle", () => {
    expect(visibleRatio(rect(0, 0, 100, 100), rect(50, 0, 100, 100))).toBe(0.5);
  });
});
```

Create `F:\meihua\universal-manga-translator\packages\shared\src\hashing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCacheKey, sha256Hex } from "./hashing";

describe("hashing helpers", () => {
  it("creates deterministic sha256 hashes", () => {
    expect(sha256Hex(Buffer.from("manga"))).toBe("7837f1bc7d5bfed8cf019f5c9f8b7759e4094ff99b29515cc2f03f38898f8db8");
  });

  it("builds stable cache keys", () => {
    expect(buildCacheKey({ imageHash: "abc", targetLanguage: "zh-CN", providerProfile: "mock", layoutVersion: 1 })).toBe(
      "img:abc:lang:zh-CN:provider:mock:layout:1",
    );
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```powershell
pnpm --filter @umt/shared test
```

Expected: FAIL because `geometry.ts` and `hashing.ts` are missing.

- [ ] **Step 4: Implement shared types and protocol**

Create `F:\meihua\universal-manga-translator\packages\shared\src\types.ts`:

```ts
export type Priority = "p0" | "p1" | "p2" | "p3";
export type JobStatus = "queued" | "processing" | "cached" | "completed" | "empty" | "failed" | "skipped";

export interface Rect { x: number; y: number; width: number; height: number; }
export interface Size { width: number; height: number; }

export interface SurfaceTask {
  surfaceId: string;
  pageUrl: string;
  domain: string;
  imageUrl?: string;
  imageData?: string;
  viewportPriority: Priority;
  surfaceRect: Rect;
  naturalSize: Size;
  renderSize: Size;
  readingDirection: "auto" | "ltr" | "rtl" | "vertical";
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TextRegion {
  id: string;
  box: Rect;
  sourceText: string;
  translatedText: string;
  confidence: number;
  orientation: "horizontal" | "vertical" | "unknown";
  kind: "dialogue" | "narration" | "sfx" | "unknown";
}

export interface OverlayStyle {
  fontSize: number;
  writingMode: "horizontal-tb" | "vertical-rl";
  align: "left" | "center" | "right";
  background: string;
  color: string;
}

export interface OverlayRegion extends TextRegion {
  style: OverlayStyle;
}

export interface SurfaceResult {
  surfaceId: string;
  imageHash: string;
  status: "cached" | "completed" | "empty";
  regions: OverlayRegion[];
  providerProfile: string;
  layoutVersion: number;
  elapsedMs: number;
}

export interface FailedResult {
  surfaceId: string;
  status: "failed";
  recoverable: boolean;
  error: string;
}
```

Create `F:\meihua\universal-manga-translator\packages\shared\src\protocol.ts`:

```ts
import type { FailedResult, JobStatus, SurfaceResult, SurfaceTask } from "./types";

export interface SubmitSurfaceRequest { task: SurfaceTask; }
export interface SubmitSurfaceResponse { ok: true; surfaceId: string; status: JobStatus; result?: SurfaceResult; }
export interface ErrorResponse { ok: false; error: string; }
export type ApiResponse<T> = T | ErrorResponse;

export type ServerEvent =
  | { type: "backend.ready"; port: number }
  | { type: "job.queued"; surfaceId: string }
  | { type: "job.processing"; surfaceId: string }
  | { type: "job.cached"; surfaceId: string; result: SurfaceResult }
  | { type: "job.completed"; surfaceId: string; result: SurfaceResult }
  | { type: "job.failed"; surfaceId: string; result: FailedResult };
```

- [ ] **Step 5: Implement shared helpers**

Create `F:\meihua\universal-manga-translator\packages\shared\src\geometry.ts`:

```ts
import type { Rect, Size } from "./types";

export function mapNaturalBoxToRenderedBox(box: Rect, naturalSize: Size, renderedRect: Rect): Rect {
  const scaleX = renderedRect.width / naturalSize.width;
  const scaleY = renderedRect.height / naturalSize.height;
  return {
    x: renderedRect.x + box.x * scaleX,
    y: renderedRect.y + box.y * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return x2 > x1 && y2 > y1 ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null;
}

export function area(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

export function visibleRatio(subject: Rect, viewport: Rect): number {
  const subjectArea = area(subject);
  if (subjectArea === 0) return 0;
  const overlap = intersectRect(subject, viewport);
  return overlap ? area(overlap) / subjectArea : 0;
}
```

Create `F:\meihua\universal-manga-translator\packages\shared\src\hashing.ts`:

```ts
import { createHash } from "node:crypto";

export interface CacheKeyInput {
  imageHash: string;
  targetLanguage: string;
  providerProfile: string;
  layoutVersion: number;
}

export function sha256Hex(data: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function buildCacheKey(input: CacheKeyInput): string {
  return `img:${input.imageHash}:lang:${input.targetLanguage}:provider:${input.providerProfile}:layout:${input.layoutVersion}`;
}
```

Create `F:\meihua\universal-manga-translator\packages\shared\src\index.ts`:

```ts
export * from "./types";
export * from "./protocol";
export * from "./geometry";
export * from "./hashing";
```

- [ ] **Step 6: Run shared tests**

Run:

```powershell
pnpm --filter @umt/shared test
pnpm --filter @umt/shared typecheck
```

Expected: both pass.

- [ ] **Step 7: Commit shared package**

Run:

```powershell
git add packages/shared package.json pnpm-lock.yaml
git commit -m "feat(shared): add protocol and geometry helpers"
```

Expected: commit succeeds.

---

## Task 3: Backend Health, Mock Provider, and Submit API

**Files:**
- Create: `F:\meihua\universal-manga-translator\apps\server\package.json`
- Create: `F:\meihua\universal-manga-translator\apps\server\tsconfig.json`
- Create: `F:\meihua\universal-manga-translator\apps\server\src\config\env.ts`
- Create: `F:\meihua\universal-manga-translator\apps\server\src\api\server.ts`
- Create: `F:\meihua\universal-manga-translator\apps\server\src\providers\provider.ts`
- Create: `F:\meihua\universal-manga-translator\apps\server\src\providers\mock-provider.ts`
- Create: `F:\meihua\universal-manga-translator\apps\server\src\layout\layout.ts`
- Create: `F:\meihua\universal-manga-translator\apps\server\src\main.ts`
- Create: `F:\meihua\universal-manga-translator\apps\server\src\api\server.test.ts`

- [ ] **Step 1: Create backend package metadata**

Create `F:\meihua\universal-manga-translator\apps\server\package.json`:

```json
{
  "name": "@umt/server",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/main.ts",
    "start": "node dist/main.js",
    "test": "vitest run src/**/*.test.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@fastify/cors": "^9.0.0",
    "@umt/shared": "workspace:*",
    "better-sqlite3": "^11.0.0",
    "fastify": "^4.28.0",
    "sharp": "^0.33.4",
    "tsx": "^4.16.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11"
  }
}
```

Create `F:\meihua\universal-manga-translator\apps\server\tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"],
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Write failing backend API test**

Create `F:\meihua\universal-manga-translator\apps\server\src\api\server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildServer } from "./server";

const task = {
  surfaceId: "surface-1",
  pageUrl: "https://example.test/chapter/1",
  domain: "example.test",
  imageData: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iODAwIj48cmVjdCB3aWR0aD0iNjAwIiBoZWlnaHQ9IjgwMCIgZmlsbD0id2hpdGUiLz48dGV4dCB4PSIxMDAiIHk9IjEwMCI+SGVsbG88L3RleHQ+PC9zdmc+",
  viewportPriority: "p0",
  surfaceRect: { x: 0, y: 0, width: 600, height: 800 },
  naturalSize: { width: 600, height: 800 },
  renderSize: { width: 600, height: 800 },
  readingDirection: "auto",
  sourceLanguage: "auto",
  targetLanguage: "zh-CN",
};

describe("backend API", () => {
  it("returns health information", async () => {
    const app = await buildServer({ provider: "mock", targetLanguage: "zh-CN" });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, provider: "mock", targetLanguage: "zh-CN" });
    await app.close();
  });

  it("processes a submitted surface with mock provider", async () => {
    const app = await buildServer({ provider: "mock", targetLanguage: "zh-CN" });
    const response = await app.inject({ method: "POST", url: "/v1/surfaces/submit", payload: { task } });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.regions[0].translatedText).toBe("娴嬭瘯璇戞枃");
    await app.close();
  });
});
```

- [ ] **Step 3: Run test and verify failure**

Run:

```powershell
pnpm install
pnpm --filter @umt/server test
```

Expected: FAIL because `server.ts` does not exist.

- [ ] **Step 4: Implement backend config, provider, layout, API, and main**

Create `F:\meihua\universal-manga-translator\apps\server\src\config\env.ts`:

```ts
export interface ServerConfig {
  port: number;
  provider: string;
  targetLanguage: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 47831),
    provider: env.VISION_PROVIDER ?? "mock",
    targetLanguage: env.TARGET_LANGUAGE ?? "zh-CN",
    openaiBaseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    openaiApiKey: env.OPENAI_API_KEY ?? "",
    openaiModel: env.OPENAI_MODEL ?? "gpt-4.1-mini",
  };
}
```

Create `F:\meihua\universal-manga-translator\apps\server\src\providers\provider.ts`:

```ts
import type { SurfaceTask, TextRegion } from "@umt/shared";

export interface ProviderInput {
  task: SurfaceTask;
  imageBuffer: Buffer;
  imageHash: string;
  width: number;
  height: number;
}

export interface VisionProvider {
  readonly profile: string;
  process(input: ProviderInput): Promise<TextRegion[]>;
}
```

Create `F:\meihua\universal-manga-translator\apps\server\src\providers\mock-provider.ts`:

```ts
import type { TextRegion } from "@umt/shared";
import type { ProviderInput, VisionProvider } from "./provider";

export class MockProvider implements VisionProvider {
  readonly profile = "mock";

  async process(input: ProviderInput): Promise<TextRegion[]> {
    return [{
      id: "r1",
      box: { x: Math.round(input.width * 0.2), y: Math.round(input.height * 0.1), width: Math.round(input.width * 0.45), height: Math.round(input.height * 0.18) },
      sourceText: "Hello",
      translatedText: "娴嬭瘯璇戞枃",
      confidence: 0.99,
      orientation: "horizontal",
      kind: "dialogue",
    }];
  }
}
```

Create `F:\meihua\universal-manga-translator\apps\server\src\layout\layout.ts`:

```ts
import type { OverlayRegion, TextRegion } from "@umt/shared";

export const LAYOUT_VERSION = 1;

export function layoutRegions(regions: TextRegion[]): OverlayRegion[] {
  return regions.map((region) => ({
    ...region,
    style: {
      fontSize: Math.max(14, Math.min(28, Math.floor(region.box.height / 4))),
      writingMode: "horizontal-tb",
      align: "center",
      background: "rgba(255,255,255,0.86)",
      color: "#111827",
    },
  }));
}
```

Create `F:\meihua\universal-manga-translator\apps\server\src\api\server.ts`:

```ts
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { buildCacheKey, sha256Hex, type SurfaceResult, type SurfaceTask } from "@umt/shared";
import { LAYOUT_VERSION, layoutRegions } from "../layout/layout";
import { MockProvider } from "../providers/mock-provider";
import type { VisionProvider } from "../providers/provider";

export interface BuildServerOptions {
  provider: string;
  targetLanguage: string;
  visionProvider?: VisionProvider;
}

function decodeImageData(imageData: string): Buffer {
  const base64 = imageData.includes(",") ? imageData.split(",").at(-1) ?? "" : imageData;
  return Buffer.from(base64, "base64");
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const provider = options.visionProvider ?? new MockProvider();
  const memoryCache = new Map<string, SurfaceResult>();
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true, provider: options.provider, targetLanguage: options.targetLanguage }));

  app.post<{ Body: { task: SurfaceTask } }>("/v1/surfaces/submit", async (request) => {
    const started = Date.now();
    const task = request.body.task;
    const imageBuffer = decodeImageData(task.imageData ?? "");
    const imageHash = sha256Hex(imageBuffer);
    const cacheKey = buildCacheKey({ imageHash, targetLanguage: task.targetLanguage, providerProfile: provider.profile, layoutVersion: LAYOUT_VERSION });
    const cached = memoryCache.get(cacheKey);
    if (cached) return { ok: true, surfaceId: task.surfaceId, status: "cached", result: { ...cached, surfaceId: task.surfaceId, status: "cached" } };

    const regions = await provider.process({ task, imageBuffer, imageHash, width: task.naturalSize.width, height: task.naturalSize.height });
    const result: SurfaceResult = {
      surfaceId: task.surfaceId,
      imageHash,
      status: regions.length ? "completed" : "empty",
      regions: layoutRegions(regions),
      providerProfile: provider.profile,
      layoutVersion: LAYOUT_VERSION,
      elapsedMs: Date.now() - started,
    };
    memoryCache.set(cacheKey, result);
    return { ok: true, surfaceId: task.surfaceId, status: result.status, result };
  });

  return app;
}
```

Create `F:\meihua\universal-manga-translator\apps\server\src\main.ts`:

```ts
import { buildServer } from "./api/server";
import { loadConfig } from "./config/env";

const config = loadConfig();
const app = await buildServer({ provider: config.provider, targetLanguage: config.targetLanguage });
await app.listen({ host: "127.0.0.1", port: config.port });
console.log(`Universal Manga Translator backend listening on http://127.0.0.1:${config.port}`);
```

- [ ] **Step 5: Run backend tests**

Run:

```powershell
pnpm --filter @umt/server test
pnpm --filter @umt/server typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit backend vertical slice**

Run:

```powershell
git add apps/server package.json pnpm-lock.yaml
git commit -m "feat(server): add health and mock submit api"
```

Expected: commit succeeds.

---

## Task 4: OpenAI-Compatible Provider

**Files:**
- Create: `F:\meihua\universal-manga-translator\apps\server\src\providers\openai-vision-provider.ts`
- Create: `F:\meihua\universal-manga-translator\apps\server\src\providers\openai-vision-provider.test.ts`
- Modify: `F:\meihua\universal-manga-translator\apps\server\src\main.ts`

- [ ] **Step 1: Write failing provider test**

Create `F:\meihua\universal-manga-translator\apps\server\src\providers\openai-vision-provider.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { OpenAIVisionProvider } from "./openai-vision-provider";

describe("OpenAIVisionProvider", () => {
  it("parses JSON regions from an OpenAI-compatible response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ regions: [{
        id: "r1",
        box: { x: 1, y: 2, width: 3, height: 4 },
        sourceText: "銇撱倱銇仭銇?,
        translatedText: "浣犲ソ",
        confidence: 0.9,
        orientation: "vertical",
        kind: "dialogue",
      }] }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const provider = new OpenAIVisionProvider({ baseUrl: "https://api.example.test/v1", apiKey: "key", model: "vision", targetLanguage: "zh-CN" });
    const regions = await provider.process({
      task: {
        surfaceId: "s1",
        pageUrl: "https://example.test",
        domain: "example.test",
        viewportPriority: "p0",
        surfaceRect: { x: 0, y: 0, width: 10, height: 10 },
        naturalSize: { width: 10, height: 10 },
        renderSize: { width: 10, height: 10 },
        readingDirection: "auto",
        sourceLanguage: "auto",
        targetLanguage: "zh-CN",
      },
      imageBuffer: Buffer.from("abc"),
      imageHash: "hash",
      width: 10,
      height: 10,
    });

    expect(regions[0]?.translatedText).toBe("浣犲ソ");
  });
});
```

- [ ] **Step 2: Run provider test and verify failure**

Run:

```powershell
pnpm --filter @umt/server test -- src/providers/openai-vision-provider.test.ts
```

Expected: FAIL because provider does not exist.

- [ ] **Step 3: Implement provider**

Create `F:\meihua\universal-manga-translator\apps\server\src\providers\openai-vision-provider.ts`:

```ts
import type { TextRegion } from "@umt/shared";
import type { ProviderInput, VisionProvider } from "./provider";

export interface OpenAIVisionProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  targetLanguage: string;
}

export class OpenAIVisionProvider implements VisionProvider {
  readonly profile: string;

  constructor(private readonly options: OpenAIVisionProviderOptions) {
    this.profile = `openai-compatible:${options.model}`;
  }

  async process(input: ProviderInput): Promise<TextRegion[]> {
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0.1,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: `Detect manga text regions and translate them to ${this.options.targetLanguage}. Return only JSON: {"regions":[{"id":"r1","box":{"x":0,"y":0,"width":1,"height":1},"sourceText":"","translatedText":"","confidence":0.9,"orientation":"horizontal","kind":"dialogue"}]}` },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${input.imageBuffer.toString("base64")}` } },
          ],
        }],
      }),
    });
    if (!response.ok) throw new Error(`OpenAI-compatible provider failed: ${response.status}`);
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content ?? "{\"regions\":[]}";
    const parsed = JSON.parse(content) as { regions?: TextRegion[] };
    return Array.isArray(parsed.regions) ? parsed.regions : [];
  }
}
```

- [ ] **Step 4: Select provider from config**

Modify `F:\meihua\universal-manga-translator\apps\server\src\main.ts`:

```ts
import { buildServer } from "./api/server";
import { loadConfig } from "./config/env";
import { MockProvider } from "./providers/mock-provider";
import { OpenAIVisionProvider } from "./providers/openai-vision-provider";

const config = loadConfig();
const visionProvider = config.provider === "openai-compatible"
  ? new OpenAIVisionProvider({ baseUrl: config.openaiBaseUrl, apiKey: config.openaiApiKey, model: config.openaiModel, targetLanguage: config.targetLanguage })
  : new MockProvider();
const app = await buildServer({ provider: config.provider, targetLanguage: config.targetLanguage, visionProvider });
await app.listen({ host: "127.0.0.1", port: config.port });
console.log(`Universal Manga Translator backend listening on http://127.0.0.1:${config.port}`);
```

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
pnpm --filter @umt/server test
pnpm --filter @umt/server typecheck
git add apps/server/src/providers apps/server/src/main.ts
git commit -m "feat(server): add openai compatible vision provider"
```

Expected: tests pass and commit succeeds.

---

## Task 5: Extension Skeleton, Detector, and Scheduler

**Files:**
- Create: `F:\meihua\universal-manga-translator\apps\extension\package.json`
- Create: `F:\meihua\universal-manga-translator\apps\extension\tsconfig.json`
- Create: `F:\meihua\universal-manga-translator\apps\extension\vite.config.ts`
- Create: `F:\meihua\universal-manga-translator\apps\extension\public\manifest.json`
- Create: `F:\meihua\universal-manga-translator\apps\extension\src\content\detector\surface-detector.ts`
- Create: `F:\meihua\universal-manga-translator\apps\extension\src\content\scheduler\viewport-scheduler.ts`
- Create: `F:\meihua\universal-manga-translator\apps\extension\src\content\client\backend-client.ts`
- Create: `F:\meihua\universal-manga-translator\apps\extension\src\content\panel\floating-panel.ts`
- Create: `F:\meihua\universal-manga-translator\apps\extension\src\content\main.ts`
- Create: `F:\meihua\universal-manga-translator\apps\extension\src\background\main.ts`
- Create: `F:\meihua\universal-manga-translator\apps\extension\src\content\detector\surface-detector.test.ts`
- Create: `F:\meihua\universal-manga-translator\apps\extension\src\content\scheduler\viewport-scheduler.test.ts`

- [ ] **Step 1: Create extension package and build files**

Create `F:\meihua\universal-manga-translator\apps\extension\package.json`:

```json
{
  "name": "@umt/extension",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "vite build && node scripts/copy-static.mjs",
    "dev": "vite build --watch",
    "test": "vitest run src/**/*.test.ts --environment jsdom",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "@umt/shared": "workspace:*" },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "jsdom": "^24.1.0",
    "vite": "^5.3.0"
  }
}
```

Create `F:\meihua\universal-manga-translator\apps\extension\tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["chrome", "vitest/globals"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "vite.config.ts"]
}
```

Create `F:\meihua\universal-manga-translator\apps\extension\vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, "src/content/main.ts"),
        background: resolve(__dirname, "src/background/main.ts"),
      },
      output: { entryFileNames: "[name].js" },
    },
  },
});
```

Create `F:\meihua\universal-manga-translator\apps\extension\public\manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Universal Manga Translator",
  "version": "0.1.0",
  "description": "Personal universal manga translation overlay for browser reading.",
  "permissions": ["storage", "activeTab", "tabs"],
  "host_permissions": ["http://127.0.0.1:47831/*", "http://*/*", "https://*/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [{ "matches": ["http://*/*", "https://*/*"], "js": ["content.js"], "run_at": "document_idle" }],
  "action": { "default_title": "Universal Manga Translator" }
}
```

- [ ] **Step 2: Add a post-build manifest copy script**

Create `F:\meihua\universal-manga-translator\apps\extension\scripts\copy-static.mjs`:

```js
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const target = resolve("dist/manifest.json");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(resolve("public/manifest.json"), target);
```

- [ ] **Step 3: Write failing detector and scheduler tests**

Create `F:\meihua\universal-manga-translator\apps\extension\src\content\detector\surface-detector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectImageSurfaces } from "./surface-detector";

describe("detectImageSurfaces", () => {
  it("keeps large manga-like images and ignores small icons", () => {
    document.body.innerHTML = `<img id="icon" src="/icon.png" width="32" height="32" /><img id="page" src="/chapter/page-001.jpg" width="800" height="1200" />`;
    Object.defineProperty(document.querySelector("#icon"), "getBoundingClientRect", { value: () => ({ x: 0, y: 0, width: 32, height: 32 }) });
    Object.defineProperty(document.querySelector("#page"), "getBoundingClientRect", { value: () => ({ x: 0, y: 0, width: 800, height: 1200 }) });
    const surfaces = detectImageSurfaces(document);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]?.element.id).toBe("page");
  });
});
```

Create `F:\meihua\universal-manga-translator\apps\extension\src\content\scheduler\viewport-scheduler.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { prioritizeSurfaces } from "./viewport-scheduler";

const surface = (surfaceId: string, y: number) => ({
  surfaceId,
  element: document.createElement("img"),
  imageUrl: `/${surfaceId}.jpg`,
  rect: { x: 0, y, width: 800, height: 1000 },
  naturalSize: { width: 800, height: 1000 },
  score: 10,
});

describe("prioritizeSurfaces", () => {
  it("assigns p0 to visible surfaces and p1 to nearby surfaces", () => {
    const result = prioritizeSurfaces([surface("visible", 100), surface("near", 900), surface("far", 5000)], { x: 0, y: 0, width: 1000, height: 800 });
    expect(result.map((item) => [item.surface.surfaceId, item.priority])).toEqual([["visible", "p0"], ["near", "p1"], ["far", "p2"]]);
  });
});
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```powershell
pnpm install
pnpm --filter @umt/extension test
```

Expected: FAIL because detector and scheduler modules do not exist.

- [ ] **Step 5: Implement detector and scheduler**

Create `F:\meihua\universal-manga-translator\apps\extension\src\content\detector\surface-detector.ts`:

```ts
import type { Rect, Size } from "@umt/shared";

export interface DetectedSurface {
  surfaceId: string;
  element: HTMLImageElement;
  imageUrl: string;
  rect: Rect;
  naturalSize: Size;
  score: number;
}

function rectFromElement(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function scoreImage(img: HTMLImageElement, rect: Rect): number {
  let score = 0;
  if (rect.width >= 300 && rect.height >= 300) score += 4;
  if (rect.height / Math.max(rect.width, 1) >= 1.1) score += 3;
  if (/manga|comic|chapter|page|webtoon|reader/i.test(img.currentSrc || img.src)) score += 2;
  if (rect.width >= 600) score += 1;
  return score;
}

export function detectImageSurfaces(root: Document = document): DetectedSurface[] {
  return [...root.querySelectorAll<HTMLImageElement>("img")]
    .map((img, index) => {
      const rect = rectFromElement(img);
      const imageUrl = img.currentSrc || img.src;
      const naturalSize = { width: img.naturalWidth || Number(img.width) || rect.width, height: img.naturalHeight || Number(img.height) || rect.height };
      return { surfaceId: `img:${index}:${imageUrl}`, element: img, imageUrl, rect, naturalSize, score: scoreImage(img, rect) };
    })
    .filter((surface) => surface.score >= 6 && surface.imageUrl.length > 0);
}
```

Create `F:\meihua\universal-manga-translator\apps\extension\src\content\scheduler\viewport-scheduler.ts`:

```ts
import { visibleRatio, type Priority, type Rect } from "@umt/shared";
import type { DetectedSurface } from "../detector/surface-detector";

export interface PrioritizedSurface {
  surface: DetectedSurface;
  priority: Priority;
}

export function prioritizeSurfaces(surfaces: DetectedSurface[], viewport: Rect): PrioritizedSurface[] {
  return surfaces.map((surface) => {
    const ratio = visibleRatio(surface.rect, viewport);
    const distance = surface.rect.y - (viewport.y + viewport.height);
    const priority: Priority = ratio > 0.05 ? "p0" : distance >= -viewport.height && distance <= viewport.height * 2 ? "p1" : "p2";
    return { surface, priority };
  });
}
```

- [ ] **Step 6: Implement backend client, panel, and content entry**

Create `F:\meihua\universal-manga-translator\apps\extension\src\content\client\backend-client.ts`:

```ts
import type { ApiResponse, SubmitSurfaceRequest, SubmitSurfaceResponse, SurfaceTask } from "@umt/shared";

export class BackendClient {
  constructor(private readonly baseUrl = "http://127.0.0.1:47831") {}

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok && Boolean((await response.json()).ok);
    } catch {
      return false;
    }
  }

  async submit(task: SurfaceTask): Promise<ApiResponse<SubmitSurfaceResponse>> {
    const response = await fetch(`${this.baseUrl}/v1/surfaces/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task } satisfies SubmitSurfaceRequest),
    });
    return (await response.json()) as ApiResponse<SubmitSurfaceResponse>;
  }
}
```

Create `F:\meihua\universal-manga-translator\apps\extension\src\content\panel\floating-panel.ts`:

```ts
export interface FloatingPanelActions {
  onTranslateCurrent: () => void;
  onRescan: () => void;
  onToggleOverlays: () => void;
}

export class FloatingPanel {
  readonly root: HTMLDivElement;
  private readonly status: HTMLDivElement;

  constructor(actions: FloatingPanelActions) {
    this.root = document.createElement("div");
    this.root.dataset.umtPanel = "true";
    this.root.style.cssText = "position:fixed;right:16px;top:96px;z-index:2147483647;background:#111827;color:white;padding:10px;border-radius:12px;font:12px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.25);display:grid;gap:6px;";
    this.status = document.createElement("div");
    this.status.textContent = "UMT: connecting";
    this.root.append(this.status, this.button("缈昏瘧褰撳墠灞?, actions.onTranslateCurrent), this.button("閲嶆柊鎵弿", actions.onRescan), this.button("闅愯棌/鏄剧ず", actions.onToggleOverlays));
  }

  mount(): void {
    if (!document.documentElement.contains(this.root)) document.documentElement.append(this.root);
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText = "border:0;border-radius:8px;padding:6px 8px;cursor:pointer;";
    button.addEventListener("click", onClick);
    return button;
  }
}
```

Create `F:\meihua\universal-manga-translator\apps\extension\src\content\main.ts`:

```ts
import { BackendClient } from "./client/backend-client";
import { detectImageSurfaces } from "./detector/surface-detector";
import { FloatingPanel } from "./panel/floating-panel";
import { prioritizeSurfaces } from "./scheduler/viewport-scheduler";

const client = new BackendClient();

function viewportRect() {
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}

function scan(): void {
  const prioritized = prioritizeSurfaces(detectImageSurfaces(document), viewportRect());
  panel.setStatus(`UMT: found ${prioritized.length} manga surfaces`);
}

const panel = new FloatingPanel({
  onTranslateCurrent: scan,
  onRescan: scan,
  onToggleOverlays: () => panel.setStatus("UMT: toggled overlays"),
});

panel.mount();
void client.health().then((ok) => panel.setStatus(ok ? "UMT: backend connected" : "UMT: backend offline"));
```

Create `F:\meihua\universal-manga-translator\apps\extension\src\background\main.ts`:

```ts
chrome.runtime.onInstalled.addListener(() => {
  console.log("Universal Manga Translator installed");
});
```

- [ ] **Step 7: Run tests, build, and commit**

Run:

```powershell
pnpm --filter @umt/extension test
pnpm --filter @umt/extension build
pnpm --filter @umt/extension typecheck
git add apps/extension package.json pnpm-lock.yaml
git commit -m "feat(extension): add detector scheduler and panel"
```

Expected: tests/build/typecheck pass and commit succeeds.

---

## Task 6: Capture, Submit, Overlay, and Manual Edit

**Files:**
- Create: `F:\meihua\universal-manga-translator\apps\extension\src\content\capture\surface-capture.ts`
- Create: `F:\meihua\universal-manga-translator\apps\extension\src\content\overlay\overlay-renderer.ts`
- Create: `F:\meihua\universal-manga-translator\apps\extension\src\content\overlay\overlay-renderer.test.ts`
- Modify: `F:\meihua\universal-manga-translator\apps\extension\src\content\main.ts`

- [ ] **Step 1: Write failing overlay test**

Create `F:\meihua\universal-manga-translator\apps\extension\src\content\overlay\overlay-renderer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SurfaceResult } from "@umt/shared";
import { loadManualEdit, OverlayRenderer, saveManualEdit } from "./overlay-renderer";

describe("OverlayRenderer", () => {
  it("renders translated regions over a surface", () => {
    document.body.innerHTML = `<img id="page" />`;
    const img = document.querySelector<HTMLImageElement>("#page")!;
    Object.defineProperty(img, "getBoundingClientRect", { value: () => ({ x: 10, y: 20, width: 500, height: 1000 }) });
    const renderer = new OverlayRenderer();
    const result: SurfaceResult = {
      surfaceId: "s1",
      imageHash: "hash",
      status: "completed",
      providerProfile: "mock",
      layoutVersion: 1,
      elapsedMs: 1,
      regions: [{
        id: "r1",
        box: { x: 100, y: 100, width: 200, height: 100 },
        sourceText: "Hello",
        translatedText: "浣犲ソ",
        confidence: 1,
        orientation: "horizontal",
        kind: "dialogue",
        style: { fontSize: 20, writingMode: "horizontal-tb", align: "center", background: "white", color: "black" },
      }],
    };
    renderer.render(img, { width: 1000, height: 2000 }, result);
    expect(document.querySelector("[data-umt-region-id='r1']")?.textContent).toBe("浣犲ソ");
  });

  it("stores manual edits by image hash and region id", () => {
    saveManualEdit("hash", "zh-CN", "r1", "鏀瑰ソ鐨勮瘧鏂?);
    expect(loadManualEdit("hash", "zh-CN", "r1")).toBe("鏀瑰ソ鐨勮瘧鏂?);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
pnpm --filter @umt/extension test -- src/content/overlay/overlay-renderer.test.ts
```

Expected: FAIL because overlay renderer does not exist.

- [ ] **Step 3: Implement capture and overlay**

Create `F:\meihua\universal-manga-translator\apps\extension\src\content\capture\surface-capture.ts`:

```ts
import type { SurfaceTask } from "@umt/shared";
import type { DetectedSurface } from "../detector/surface-detector";

export function createSurfaceTask(surface: DetectedSurface, priority: SurfaceTask["viewportPriority"]): SurfaceTask {
  return {
    surfaceId: surface.surfaceId,
    pageUrl: location.href,
    domain: location.hostname,
    imageUrl: surface.imageUrl,
    viewportPriority: priority,
    surfaceRect: surface.rect,
    naturalSize: surface.naturalSize,
    renderSize: { width: surface.rect.width, height: surface.rect.height },
    readingDirection: "auto",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
  };
}
```

Create `F:\meihua\universal-manga-translator\apps\extension\src\content\overlay\overlay-renderer.ts`:

```ts
import { mapNaturalBoxToRenderedBox, type Size, type SurfaceResult } from "@umt/shared";

const manualEdits = new Map<string, string>();

function manualEditKey(imageHash: string, targetLanguage: string, regionId: string): string {
  return `${imageHash}:${targetLanguage}:${regionId}`;
}

export function saveManualEdit(imageHash: string, targetLanguage: string, regionId: string, text: string): void {
  manualEdits.set(manualEditKey(imageHash, targetLanguage, regionId), text);
}

export function loadManualEdit(imageHash: string, targetLanguage: string, regionId: string): string | null {
  return manualEdits.get(manualEditKey(imageHash, targetLanguage, regionId)) ?? null;
}

export class OverlayRenderer {
  private readonly root: HTMLDivElement;

  constructor() {
    this.root = document.createElement("div");
    this.root.dataset.umtOverlayRoot = "true";
    this.root.style.cssText = "position:absolute;left:0;top:0;z-index:2147483646;pointer-events:none;";
    document.documentElement.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? "block" : "none";
  }

  clearSurface(surfaceId: string): void {
    for (const node of [...this.root.querySelectorAll(`[data-umt-surface-id='${CSS.escape(surfaceId)}']`)]) node.remove();
  }

  render(element: HTMLElement, naturalSize: Size, result: SurfaceResult): void {
    this.clearSurface(result.surfaceId);
    const rect = element.getBoundingClientRect();
    const renderedRect = { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height };
    for (const region of result.regions) {
      const box = mapNaturalBoxToRenderedBox(region.box, naturalSize, renderedRect);
      const node = document.createElement("div");
      node.dataset.umtSurfaceId = result.surfaceId;
      node.dataset.umtRegionId = region.id;
      node.textContent = loadManualEdit(result.imageHash, "zh-CN", region.id) ?? region.translatedText;
      node.style.cssText = [
        "position:absolute",
        `left:${box.x}px`,
        `top:${box.y}px`,
        `width:${box.width}px`,
        `min-height:${box.height}px`,
        `font:${region.style.fontSize}px/1.25 system-ui,sans-serif`,
        `background:${region.style.background}`,
        `color:${region.style.color}`,
        `text-align:${region.style.align}`,
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "box-sizing:border-box",
        "padding:4px",
        "border-radius:6px",
        "white-space:pre-wrap",
        "pointer-events:auto",
      ].join(";");
      node.addEventListener("click", () => {
        const next = window.prompt("淇敼璇戞枃", node.textContent ?? "");
        if (next !== null) {
          node.textContent = next;
          saveManualEdit(result.imageHash, "zh-CN", region.id, next);
        }
      });
      this.root.append(node);
    }
  }
}
```

- [ ] **Step 4: Wire submit and render in content script**

Replace `F:\meihua\universal-manga-translator\apps\extension\src\content\main.ts` with:

```ts
import { BackendClient } from "./client/backend-client";
import { createSurfaceTask } from "./capture/surface-capture";
import { detectImageSurfaces } from "./detector/surface-detector";
import { OverlayRenderer } from "./overlay/overlay-renderer";
import { FloatingPanel } from "./panel/floating-panel";
import { prioritizeSurfaces } from "./scheduler/viewport-scheduler";

const client = new BackendClient();
const renderer = new OverlayRenderer();
let overlaysVisible = true;

function viewportRect() {
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}

async function translateCurrent(): Promise<void> {
  const prioritized = prioritizeSurfaces(detectImageSurfaces(document), viewportRect()).filter((item) => item.priority === "p0" || item.priority === "p1");
  panel.setStatus(`UMT: submitting ${prioritized.length} surfaces`);
  for (const item of prioritized) {
    const response = await client.submit(createSurfaceTask(item.surface, item.priority));
    if (response.ok && response.result) renderer.render(item.surface.element, item.surface.naturalSize, response.result);
  }
  panel.setStatus(`UMT: rendered ${prioritized.length} surfaces`);
}

function scan(): void {
  const prioritized = prioritizeSurfaces(detectImageSurfaces(document), viewportRect());
  panel.setStatus(`UMT: found ${prioritized.length} manga surfaces`);
}

const panel = new FloatingPanel({
  onTranslateCurrent: () => void translateCurrent(),
  onRescan: scan,
  onToggleOverlays: () => {
    overlaysVisible = !overlaysVisible;
    renderer.setVisible(overlaysVisible);
    panel.setStatus(overlaysVisible ? "UMT: overlays visible" : "UMT: overlays hidden");
  },
});

panel.mount();
void client.health().then((ok) => panel.setStatus(ok ? "UMT: backend connected" : "UMT: backend offline"));
```

- [ ] **Step 5: Run tests/build and commit**

Run:

```powershell
pnpm --filter @umt/extension test
pnpm --filter @umt/extension build
pnpm --filter @umt/extension typecheck
git add apps/extension/src/content
git commit -m "feat(extension): submit surfaces and render editable overlays"
```

Expected: tests/build/typecheck pass and commit succeeds.

---

## Task 7: Fixture and E2E Smoke Test

**Files:**
- Create: `F:\meihua\universal-manga-translator\tests\fixtures\simple-manga.html`
- Create: `F:\meihua\universal-manga-translator\tests\fixtures\fixtures.css`
- Create: `F:\meihua\universal-manga-translator\tests\fixtures\page-1.svg`
- Create: `F:\meihua\universal-manga-translator\tests\integration\extension-smoke.spec.ts`

- [ ] **Step 1: Create fixture files**

Create `F:\meihua\universal-manga-translator\tests\fixtures\fixtures.css`:

```css
body { margin: 0; background: #0f172a; }
.reader { width: 820px; margin: 0 auto; background: #111827; padding: 24px 0; }
.reader img { display: block; width: 800px; height: 1200px; margin: 24px auto; background: white; }
.icon { width: 32px; height: 32px; }
```

Create `F:\meihua\universal-manga-translator\tests\fixtures\page-1.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200">
  <rect width="800" height="1200" fill="white"/>
  <ellipse cx="400" cy="220" rx="220" ry="120" fill="#f8fafc" stroke="#111827" stroke-width="4"/>
  <text x="330" y="230" font-size="42">Hello</text>
</svg>
```

Create `F:\meihua\universal-manga-translator\tests\fixtures\simple-manga.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <link rel="stylesheet" href="./fixtures.css" />
    <title>Simple Manga Fixture</title>
  </head>
  <body>
    <img class="icon" src="./page-1.svg" alt="small icon" />
    <main class="reader">
      <img src="./page-1.svg" alt="page 1" />
    </main>
  </body>
</html>
```

- [ ] **Step 2: Create e2e smoke test**

Create `F:\meihua\universal-manga-translator\tests\integration\extension-smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");

test("fixture page has one large manga image", async ({ page }) => {
  await page.goto(`file://${resolve(root, "tests/fixtures/simple-manga.html")}`);
  await expect(page.locator(".reader img")).toHaveCount(1);
  const box = await page.locator(".reader img").boundingBox();
  expect(box?.width).toBe(800);
});

test("backend health is reachable during e2e", async ({ request }) => {
  const server = spawn("pnpm", ["--filter", "@umt/server", "dev"], { cwd: root, shell: true });
  try {
    await expect.poll(async () => {
      try {
        const response = await request.get("http://127.0.0.1:47831/health");
        return response.ok();
      } catch {
        return false;
      }
    }, { timeout: 15000 }).toBe(true);
  } finally {
    server.kill();
  }
});
```

- [ ] **Step 3: Run e2e tests and commit**

Run:

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
git add tests package.json pnpm-lock.yaml
git commit -m "test: add fixture and e2e smoke tests"
```

Expected: Playwright tests pass and commit succeeds.

---

## Task 8: Final Verification and Manual Browser Check

**Files:**
- Modify: `F:\meihua\universal-manga-translator\README.md`

- [ ] **Step 1: Run full automated verification**

Run:

```powershell
pnpm test
pnpm build
pnpm test:e2e
git status --short
```

Expected:

```text
All package tests pass.
All packages build.
Playwright smoke tests pass.
git status --short shows no uncommitted tracked implementation changes.
```

- [ ] **Step 2: Run manual Chrome verification**

Run backend:

```powershell
pnpm dev:server
```

Build extension:

```powershell
pnpm --filter @umt/extension build
```

Manual Chrome steps:

```text
1. Open chrome://extensions.
2. Enable Developer mode.
3. Load unpacked extension from F:\meihua\universal-manga-translator\apps\extension\dist.
4. Open F:\meihua\universal-manga-translator\tests\fixtures\simple-manga.html.
5. Confirm the panel says backend connected.
6. Click 缈昏瘧褰撳墠灞?
7. Confirm 娴嬭瘯璇戞枃 appears over the large image and not over the small icon.
8. Click 闅愯棌/鏄剧ず and confirm overlay visibility toggles.
9. Click the overlay text, edit it, and confirm the text changes.
```

- [ ] **Step 3: Record verification procedure**

Append to `F:\meihua\universal-manga-translator\README.md`:

```markdown

## MVP Verification

The MVP vertical slice is verified when `pnpm test`, `pnpm build`, and `pnpm test:e2e` pass, and the unpacked extension renders a mock translated overlay on `tests/fixtures/simple-manga.html` while connected to the local backend.
```

- [ ] **Step 4: Commit verification note**

Run:

```powershell
git add README.md
git commit -m "docs: record mvp verification procedure"
```

Expected: commit succeeds.

---

## Plan Self-Review

- Spec coverage: this plan covers scaffold, shared protocol, backend health/submit, provider boundary, detector, scheduler, overlay, manual edit MVP, and fixture smoke verification.
- Explicit deferrals: persistent SQLite submit integration, WebSocket extension status, real image download fallback, canvas/background capture, true manual crop, Google Vision, local OCR, and real-site E2E are listed as follow-up plans to avoid another tangled prototype.
- Red-flag scan: no red-flag vague instructions remain; each implementation step includes concrete file content or exact command.
- Type consistency: `SurfaceTask`, `SurfaceResult`, `TextRegion`, `Priority`, `buildCacheKey`, `OverlayRenderer`, `BackendClient`, and provider interfaces are defined before use.



