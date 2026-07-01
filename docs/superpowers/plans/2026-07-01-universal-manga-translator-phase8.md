# Universal Manga Translator Phase 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve personal-use startup and configuration experience with a repository-level doctor command, Windows helper scripts, and clear documentation.

**Architecture:** Add dependency-free Node scripts that inspect the local repo, `.env`, backend provider configuration, and built extension artifacts. Keep checks read-only except optional PowerShell helper scripts that the user can run explicitly.

**Tech Stack:** Node ESM scripts, PowerShell helper scripts, package.json scripts, Node built-in test runner.

---

## Task 1: Doctor Script

- [ ] Write failing tests for `.env` parsing and config validation in `scripts/doctor.test.mjs`.
- [ ] Implement `scripts/doctor.mjs` exporting `parseEnvText()`, `validateDoctorState()`, and CLI output.
- [ ] Add root package scripts: `doctor` and include script tests in root `test`.
- [ ] Run `pnpm test`; expected PASS.
- [ ] Commit: `git add scripts package.json && git commit -m "feat(tools): add project doctor command"`.

## Task 2: Windows Startup Helpers

- [ ] Add `scripts/start-backend.ps1` that runs `pnpm --filter @umt/server dev` from the repo root.
- [ ] Add `scripts/build-extension.ps1` that runs `pnpm --filter @umt/extension build` and prints the unpacked extension path.
- [ ] Add `scripts/check.ps1` that runs `pnpm doctor`, `pnpm test`, and `pnpm build`.
- [ ] Run the helper scripts in non-destructive mode where possible.
- [ ] Commit: `git add scripts/*.ps1 && git commit -m "chore(tools): add Windows startup helpers"`.

## Task 3: Documentation and Verification

- [ ] Update README with a "Daily Use" section: install, build extension, start backend, load extension path, run doctor.
- [ ] Run full verification: `pnpm doctor`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm exec playwright test tests/integration/extension-loaded.spec.ts`.
- [ ] Commit: `git add README.md docs/superpowers/plans/2026-07-01-universal-manga-translator-phase8.md && git commit -m "docs: record phase 8 startup verification"`.