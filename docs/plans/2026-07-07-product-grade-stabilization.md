# Product-grade Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current working Chrome extension into a more product-grade manga translator by tightening release automation, setup/self-test, reader-page boundaries, queue semantics, and high-frequency UI feedback.

**Architecture:** Keep the pure Chrome extension as the main product. Improve behavior at the existing boundaries instead of adding new subsystems: popup owns user configuration and self-test, content script owns reader detection/queue/rendering, core owns OCR/translation provider behavior, docs/scripts own release trust. Desktop/backend remain advanced and should not be required for the primary path.

**Tech Stack:** Chrome MV3, TypeScript, Vite, Node test runner, pnpm workspaces, GitHub Actions, existing `@umt/core`, `@umt/extension`, `@umt/server`, `@umt/desktop` packages.

---

## Scope

This plan implements the first product-grade stabilization pass from `docs/product-roadmap.md`:

- Phase 1 release foundation.
- Phase 2 reader detection and queue behavior.
- Phase 6 UI polish for popup/progress/high-frequency controls.

This plan intentionally does not implement inpaint, mobile browser support, desktop-first packaging, or a new OCR vendor SDK.

## File Map

- `.github/workflows/ci.yml`: new CI workflow for typecheck, tests, and extension packaging.
- `scripts/docs-links.test.mjs`: add checks that roadmap and release docs stay aligned with plugin-first messaging.
- `README.md`: add concise links to product roadmap, troubleshooting, and release behavior only if needed.
- `docs/product-roadmap.md`: product direction source of truth; already created.
- `docs/release-checklist.md`: extend with CI and manual smoke-test requirements.
- `docs/api-templates.md`: add clearer self-test/provider mapping guidance if gaps are found.
- `apps/extension/src/popup/main.ts`: current popup and direct self-test implementation; keep or split only where tests prove it helps.
- `apps/extension/src/popup/main.test.ts`: popup behavior tests.
- `apps/extension/src/content/surface/surface-registry.ts`: reader-page detection.
- `apps/extension/src/content/surface/surface-registry.test.ts`: detection tests.
- `apps/extension/src/content/main.ts`: content command handling and queue integration.
- `apps/extension/src/content/queue/translation-queue.ts`: queue ordering, cancellation, status semantics.
- `apps/extension/src/content/queue/translation-queue.test.ts`: queue tests.
- `apps/extension/src/content/progress/chapter-progress.ts`: progress widget.
- `apps/extension/src/content/progress/chapter-progress.test.ts`: progress widget tests.
- `apps/extension/src/content/panel/floating-panel.ts`: floating hide/show/retranslate/select button.
- `apps/extension/src/content/panel/floating-panel.test.ts`: floating button tests.

## Implementation Rules

- Keep changes small and separately commit each task.
- Write failing tests first when behavior changes.
- Do not add user-visible controls without tests proving the controls send real commands or change real settings.
- Do not make desktop/backend part of the ordinary user path.
- Do not introduce real API keys, provider-specific defaults, or personal endpoints.

---

### Task 1: Add CI for product release confidence

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `docs/release-checklist.md`
- Test: run local commands equivalent to CI.

- [ ] **Step 1: Create a GitHub Actions workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  validate:
    runs-on: windows-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 11.0.9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Test
        run: pnpm test

      - name: Package extension
        shell: pwsh
        run: powershell -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1

      - name: Upload extension artifact
        uses: actions/upload-artifact@v4
        with:
          name: extension-release
          path: release/extension-release.zip
```

- [ ] **Step 2: Update release checklist**

Modify `docs/release-checklist.md` to include:

```markdown
9. Confirm the GitHub Actions CI run passed for the commit being released.
10. If CI did not run, run the same checks locally before publishing:

   ```powershell
   pnpm typecheck
   pnpm test
   powershell -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
   ```
```

- [ ] **Step 3: Run local verification**

Run:

```powershell
pnpm typecheck
pnpm test
powershell -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
```

Expected: all commands exit 0 and `release/extension-release.zip` is created.

- [ ] **Step 4: Commit**

```powershell
git add .github/workflows/ci.yml docs/release-checklist.md
git commit -m "ci: validate extension release"
```

---

### Task 2: Make direct API self-test product-grade

**Files:**
- Modify: `apps/extension/src/popup/main.ts`
- Modify: `apps/extension/src/popup/main.test.ts`
- Optional Create: `apps/extension/src/popup/self-test.ts` if `main.ts` becomes hard to read.

- [ ] **Step 1: Add failing tests for readable self-test failures**

Add tests in `apps/extension/src/popup/main.test.ts`:

```ts
test("popup direct self-test explains OCR quota, auth, rate limit, and mapping failures", async () => {
  const { root } = setupPopup({
    settings: configuredDirectSettings(),
    directHttp: async (request) => {
      if (request.url.includes("ocr")) {
        return {
          ok: false,
          status: 402,
          statusText: "Payment Required",
          bodyText: JSON.stringify({ code: "INSUFFICIENT_CREDITS", message: "账户积分不足" }),
          error: "账户积分不足",
          headers: { "content-type": "application/json" },
        };
      }
      return okModelsResponse();
    },
  });

  await click(root, "[data-action='open-api-settings']");
  await click(root, "[data-action='self-test']");

  assert.match(root.textContent ?? "", /OCR/);
  assert.match(root.textContent ?? "", /额度|积分不足|402/);
});
```

Add companion tests for:

```ts
test("popup direct self-test reports non-json translator base url guidance", async () => {
  // AI endpoint returns HTML with 200 or 404.
  // Expected text includes "Base URL" and "/v1".
});

test("popup direct self-test reports OCR response with zero parsed regions as mapping guidance", async () => {
  // OCR returns JSON with no configured regions path.
  // Expected text includes "字段映射" or "未解析到文字区域".
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```powershell
pnpm --filter @umt/extension test -- main.test
```

Expected: new tests fail because self-test does not yet classify all cases.

- [ ] **Step 3: Implement error classification**

If keeping code in `main.ts`, add small helpers near `extractProviderError`:

```ts
function explainHttpFailure(prefix: string, status: number | undefined, bodyText: string, fallback: string): string {
  const detail = extractProviderError(bodyText) || fallback;
  const statusText = status ? `${status} ` : "";
  if (/402|credit|quota|余额|额度|积分不足/i.test(`${statusText}${detail}`)) return `${prefix}失败：${statusText}${detail}。账户额度不足，请充值或切换 API Key。`;
  if (/401|403|unauthorized|forbidden|invalid.?key|鉴权|权限/i.test(`${statusText}${detail}`)) return `${prefix}失败：${statusText}${detail}。API Key 无效或没有权限。`;
  if (/429|rate.?limit|qps|too many/i.test(`${statusText}${detail}`)) return `${prefix}失败：${statusText}${detail}。请求过快或 QPS 受限，请稍后重试或降低并发。`;
  return `${prefix}失败：${statusText}${detail}`.trim();
}
```

Update OCR self-test:

```ts
if (!response.ok) return explainHttpFailure("OCR", response.status, response.bodyText, response.error);
```

Add a lightweight parsed-region check by importing existing parser only if it is browser-safe. If not browser-safe, check configured region path candidates directly from JSON:

```ts
function hasAnyConfiguredPath(bodyText: string, paths: string[]): boolean {
  try {
    const parsed = JSON.parse(bodyText);
    return paths.some((path) => Array.isArray(readPath(parsed, path)) && readPath(parsed, path).length > 0);
  } catch {
    return false;
  }
}
```

Expected OCR success with no parsed path:

```ts
return "OCR 失败：接口连通，但未解析到文字区域。请检查 regionsPaths/textPaths/boxPaths 字段映射。";
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
pnpm --filter @umt/extension test -- main.test
```

Expected: popup self-test tests pass.

- [ ] **Step 5: Run extension tests**

Run:

```powershell
pnpm --filter @umt/extension test
```

Expected: all extension tests pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/extension/src/popup/main.ts apps/extension/src/popup/main.test.ts
git commit -m "feat: improve direct api self test"
```

---

### Task 3: Make reader-page detection stricter without breaking real chapter pages

**Files:**
- Modify: `apps/extension/src/content/surface/surface-registry.ts`
- Modify: `apps/extension/src/content/surface/surface-registry.test.ts`

- [ ] **Step 1: Add failing directory-page tests**

Add tests:

```ts
test("isLikelyReaderPage rejects comic detail pages even when cover and thumbnails are large", () => {
  const dom = new JSDOM(`
    <body>
      <img id="cover" src="/covers/title.webp" />
      <img class="thumb" src="/chapters/1/thumb.webp" />
      <img class="thumb" src="/chapters/2/thumb.webp" />
    </body>
  `, { url: "https://asurascans.com/comics/example-title" });
  setImageMetrics(dom.window.document.querySelector("#cover")!, { width: 800, height: 1200, naturalWidth: 800, naturalHeight: 1200, x: 100, y: 100 });
  for (const [index, image] of [...dom.window.document.querySelectorAll(".thumb")].entries()) {
    setImageMetrics(image as HTMLImageElement, { width: 520, height: 760, naturalWidth: 520, naturalHeight: 760, x: 100, y: 1400 + index * 820 });
  }

  const registry = SurfaceRegistry.scan(dom.window.document);

  assert.equal(isLikelyReaderPage(dom.window.document, registry.surfaces), false);
});
```

Add a positive test:

```ts
test("isLikelyReaderPage accepts a chapter URL with stacked page images", () => {
  // URL: https://asurascans.com/comics/title/chapter/60
  // Three 800x1300 images in one column.
  // Expected true.
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```powershell
pnpm --filter @umt/extension test -- surface-registry.test
```

Expected: directory-page test fails if current heuristics accept it.

- [ ] **Step 3: Implement stricter reader scoring**

Add helper:

```ts
function looksLikeComicDirectoryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\/comics?\/[^/]+\/?$/i.test(parsed.pathname)
      || /\/manga\/[^/]+\/?$/i.test(parsed.pathname)
      || /\/series\/[^/]+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}
```

Update `isLikelyReaderPage`:

```ts
if (looksLikeComicDirectoryUrl(root.location.href) && !looksLikeChapterUrl(root.location.href)) return false;
```

If this is too strict for real sites, prefer a score:

```ts
const hasChapterUrl = looksLikeChapterUrl(root.location.href);
const hasStackedPages = surfaces.length >= 2 && looksLikeStackedReaderSurfaces(surfaces);
if (looksLikeComicDirectoryUrl(root.location.href) && !hasStackedPages) return false;
return hasChapterUrl || hasStackedPages || singleTallReaderImage;
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
pnpm --filter @umt/extension test -- surface-registry.test
```

Expected: new negative and positive tests pass.

- [ ] **Step 5: Run extension tests**

Run:

```powershell
pnpm --filter @umt/extension test
```

Expected: all extension tests pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/extension/src/content/surface/surface-registry.ts apps/extension/src/content/surface/surface-registry.test.ts
git commit -m "fix: avoid running manga ui on directory pages"
```

---

### Task 4: Lock down queue command semantics

**Files:**
- Modify: `apps/extension/src/content/main.ts`
- Modify: `apps/extension/src/content/queue/translation-queue.ts`
- Modify: `apps/extension/src/content/queue/translation-queue.test.ts`
- Modify: `apps/extension/src/popup/main.test.ts`

- [ ] **Step 1: Add queue regression tests**

In `translation-queue.test.ts`, add:

```ts
test("TranslationQueue auto mode runs first pending page alone before later concurrency", async () => {
  const started: number[] = [];
  const release: Array<() => void> = [];
  const queue = new TranslationQueue({
    concurrency: 3,
    worker: async (surface) => {
      started.push(surface.index);
      await new Promise<void>((resolve) => release.push(resolve));
      return "completed";
    },
  });
  queue.setSurfaces([surface(1), surface(2), surface(3), surface(4)]);

  const run = queue.startAuto();
  await Promise.resolve();
  assert.deepEqual(started, [1]);

  release.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started.slice(0, 4), [1, 2, 3, 4]);

  release.splice(0).forEach((done) => done());
  await run;
});
```

In `popup/main.test.ts`, keep or add:

```ts
test("popup retranslate button targets only visible surfaces", async () => {
  const sent: string[] = [];
  const { root } = await mountEnabledPopup({ sendMessageToTab: async (_id, message) => sent.push(message.command) });
  await click(root, "[data-action='retranslate']");
  assert.deepEqual(sent, ["retranslateVisible"]);
});
```

- [ ] **Step 2: Run tests**

Run:

```powershell
pnpm --filter @umt/extension test -- translation-queue.test main.test
```

Expected: tests pass if current behavior is already correct; otherwise fail and guide the fix.

- [ ] **Step 3: Fix command conflicts only if tests fail**

Expected mapping in `apps/extension/src/content/main.ts`:

```ts
if (message.command === "translate") void translatePage(false);
if (message.command === "retranslate") void translatePage(true);
if (message.command === "retranslateVisible") void retranslateVisibleSurfaces();
```

Expected popup mapping:

```ts
root.querySelector<HTMLButtonElement>("[data-action='retranslate']")
  ?.addEventListener("click", () => void sendCommand("retranslateVisible"));
```

Do not change the full-page `retranslate` command unless a separate explicit full-chapter control is introduced.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
pnpm --filter @umt/extension test -- translation-queue.test main.test
```

Expected: queue and popup tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/extension/src/content/main.ts apps/extension/src/content/queue/translation-queue.ts apps/extension/src/content/queue/translation-queue.test.ts apps/extension/src/popup/main.test.ts
git commit -m "test: lock queue command semantics"
```

---

### Task 5: Make progress feedback immediate and trustworthy

**Files:**
- Modify: `apps/extension/src/content/progress/chapter-progress.ts`
- Modify: `apps/extension/src/content/progress/chapter-progress.test.ts`
- Modify: `apps/extension/src/content/queue/translation-queue.ts`
- Modify: `apps/extension/src/content/queue/translation-queue.test.ts`

- [ ] **Step 1: Add failing progress timing tests**

In `translation-queue.test.ts`:

```ts
test("TranslationQueue reports queued status before worker starts", async () => {
  const events: Array<{ id: string; status: string }> = [];
  const queue = new TranslationQueue({
    concurrency: 2,
    worker: async () => "completed",
    onStatusChange: (surfaceId, status) => events.push({ id: surfaceId, status }),
  });
  queue.setSurfaces([surface(1), surface(2)]);
  await queue.startAuto();

  assert.equal(events.some((event) => event.id === "s1" && event.status === "queued"), true);
  assert.equal(events.some((event) => event.id === "s1" && event.status === "translating"), true);
});
```

In `chapter-progress.test.ts`:

```ts
test("ChapterProgress renders queued and processing counts immediately", async () => {
  const progress = new ChapterProgress(storage);
  await progress.mount();
  progress.update({ total: 3, queued: 2, processing: 1, completed: 0, cached: 0, empty: 0, failed: 0, cancelled: 0, paused: false });
  assert.match(document.body.textContent ?? "", /处理中|排队|1/);
});
```

- [ ] **Step 2: Run tests and confirm behavior**

Run:

```powershell
pnpm --filter @umt/extension test -- translation-queue.test chapter-progress.test
```

Expected: tests pass or expose stale progress behavior.

- [ ] **Step 3: Implement minimal progress fix**

If progress does not update before work starts, keep status order:

```ts
for (const surface of pending) this.mark(surface.surfaceId, "queued");
```

When active processing starts:

```ts
this.processing.add(surface.surfaceId);
this.mark(surface.surfaceId, "translating");
```

If UI text is unclear, update `chapter-progress.ts` to show:

```ts
const active = snapshot.processing;
const waiting = snapshot.queued;
const done = snapshot.completed + snapshot.cached + snapshot.empty + snapshot.failed + snapshot.cancelled;
```

Render labels as:

```text
处理中 {active} · 排队 {waiting} · 已完成 {done}/{total}
```

- [ ] **Step 4: Run extension tests**

Run:

```powershell
pnpm --filter @umt/extension test
```

Expected: all extension tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/extension/src/content/progress/chapter-progress.ts apps/extension/src/content/progress/chapter-progress.test.ts apps/extension/src/content/queue/translation-queue.ts apps/extension/src/content/queue/translation-queue.test.ts
git commit -m "fix: make progress updates immediate"
```

---

### Task 6: Polish popup without adding fake controls

**Files:**
- Modify: `apps/extension/src/popup/main.ts`
- Modify: `apps/extension/src/popup/main.test.ts`

- [ ] **Step 1: Add UI contract tests**

Add tests:

```ts
test("popup main panel exposes only high-frequency controls", async () => {
  const { root } = await mountEnabledPopup();
  const text = root.textContent ?? "";
  assert.match(text, /翻译本页/);
  assert.match(text, /重翻本页/);
  assert.match(text, /框选翻译/);
  assert.match(text, /自动翻译本网站/);
  assert.match(text, /API 设置/);
  assert.doesNotMatch(text, /regionsPaths/);
  assert.doesNotMatch(text, /staticFields JSON/);
});
```

Add:

```ts
test("popup api settings page keeps advanced OCR mapping behind details", async () => {
  const { root } = await mountEnabledPopup();
  await click(root, "[data-action='open-api-settings']");
  const details = root.querySelector("details.advanced-config");
  assert.notEqual(details, null);
  assert.match(root.textContent ?? "", /高级字段映射/);
});
```

- [ ] **Step 2: Run tests**

Run:

```powershell
pnpm --filter @umt/extension test -- main.test
```

Expected: tests pass if current UI already satisfies this; otherwise fail with exact mismatch.

- [ ] **Step 3: Apply minimal UI polish**

Keep main controls:

```html
翻译本页
重翻本页
框选翻译
暂停
清除覆盖
取消队列
显示翻译气泡
自动翻译本网站
右下角显示/隐藏按钮
翻译进度条
API 设置 / 自检
```

Keep advanced fields only in API settings:

```html
regionsPaths
textPaths
boxPaths
confidencePaths
staticFields JSON
```

Do not add a new button unless a test proves it sends a command or persists a setting.

- [ ] **Step 4: Run popup tests**

Run:

```powershell
pnpm --filter @umt/extension test -- main.test
```

Expected: popup tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/extension/src/popup/main.ts apps/extension/src/popup/main.test.ts
git commit -m "test: protect popup control contract"
```

---

### Task 7: Add docs and tests for product roadmap alignment

**Files:**
- Modify: `scripts/docs-links.test.mjs`
- Modify: `README.md`
- Modify: `docs/release-checklist.md`

- [ ] **Step 1: Add docs test for roadmap**

Modify `scripts/docs-links.test.mjs`:

```js
test("product roadmap defines plugin-first product-grade priorities", () => {
  const roadmap = fs.readFileSync(path.join(root, "docs/product-roadmap.md"), "utf8");
  assert.match(roadmap, /Chrome 插件/);
  assert.match(roadmap, /Phase 1: release foundation/);
  assert.match(roadmap, /Phase 2: reader detection and queue behavior/);
  assert.match(roadmap, /Phase 6: UI polish/);
  assert.match(roadmap, /桌面端和后端只作为高级\/实验入口/);
});
```

- [ ] **Step 2: Link roadmap from README**

Add near the project structure or release section:

```markdown
## 产品路线图

产品级优化路线见 [`docs/product-roadmap.md`](docs/product-roadmap.md)。当前主线目标是纯插件优先、配置自检清晰、阅读页边界准确、队列顺滑、覆盖渲染稳定。
```

- [ ] **Step 3: Run docs tests**

Run:

```powershell
node --test scripts/docs-links.test.mjs
```

Expected: docs tests pass.

- [ ] **Step 4: Run full script tests**

Run:

```powershell
node --test scripts/*.test.mjs
```

Expected: all script tests pass.

- [ ] **Step 5: Commit**

```powershell
git add scripts/docs-links.test.mjs README.md docs/release-checklist.md docs/product-roadmap.md
git commit -m "docs: add product-grade roadmap"
```

---

### Task 8: Final release validation

**Files:**
- No required source modifications.
- Generated ignored artifact: `release/extension-release.zip`.

- [ ] **Step 1: Run full typecheck**

Run:

```powershell
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
pnpm test
```

Expected: exit 0 with 0 failed tests.

- [ ] **Step 3: Package extension**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
```

Expected:

```text
Extension release package created:
F:\meihua\universal-manga-translator\release\extension-release.zip
```

- [ ] **Step 4: Inspect working tree**

Run:

```powershell
git status -sb
git diff --check
```

Expected:

- `git diff --check` exits 0.
- Only intentional source/docs/workflow changes are present.
- `release/extension-release.zip` remains ignored.

- [ ] **Step 5: Manual smoke test**

In Chrome:

1. Open `chrome://extensions`.
2. Reload the unpacked extension from `apps/extension/dist`.
3. Open a manga chapter page.
4. Open popup and confirm it does not inject before the site is enabled.
5. Enable site.
6. Run self-test with intentionally invalid OCR key and confirm readable failure.
7. Run self-test with valid OCR/translator keys and confirm success.
8. Translate one page.
9. Toggle overlay visibility.
10. Use right-click floating menu to retranslate current page.

Expected:

- No directory page UI.
- No fake buttons.
- First page starts before later pages in automatic mode.
- Progress changes immediately when work enters queue.

- [ ] **Step 6: Final commit or PR**

If previous tasks were committed individually:

```powershell
git log --oneline -8
```

If not committed individually:

```powershell
git add .github/workflows/ci.yml README.md docs scripts apps
git commit -m "chore: stabilize product-grade extension path"
```

---

## Self-review checklist

- Phase 1 coverage: Task 1, Task 2, Task 7, Task 8.
- Phase 2 coverage: Task 3, Task 4, Task 5.
- Phase 6 coverage: Task 5, Task 6, Task 8 manual smoke test.
- No desktop/backend work is required for normal users.
- No task introduces provider-specific defaults or real API keys.
- Every behavior-changing task starts with tests.
- Every task has a concrete verification command.
