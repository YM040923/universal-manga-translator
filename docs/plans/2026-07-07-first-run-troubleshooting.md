# First-run Troubleshooting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make first-time plugin setup easier by adding an in-popup configuration checklist and concise quickstart/troubleshooting docs.

**Architecture:** Keep the pure Chrome extension as the main path. The popup API page renders a local configuration status summary from saved or currently edited settings; docs explain the same concepts with stable placeholder examples.

**Tech Stack:** Chrome MV3 popup, TypeScript, Node test runner, Markdown docs.

---

### Task 1: Popup configuration status

- [ ] Add a failing popup test that opens API settings and expects a configuration status block with OCR URL, OCR key count, OCR mapping, translator Base URL, translator key, and model state.
- [ ] Implement a small `configChecklistMarkup()` helper in `apps/extension/src/popup/main.ts`.
- [ ] Keep the checklist read-only and do not add new buttons.
- [ ] Run `pnpm --filter @umt/extension test -- main.test`.

### Task 2: Quickstart and troubleshooting docs

- [ ] Add failing docs tests requiring `docs/quickstart.md` and `docs/troubleshooting.md`.
- [ ] Create both docs with generic placeholders only.
- [ ] Link both docs from `README.md`.
- [ ] Run `node --test scripts/docs-links.test.mjs`.

### Task 3: Full validation

- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `powershell -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1`.
- [ ] Run `git diff --check`.
