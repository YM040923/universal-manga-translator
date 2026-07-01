import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearDiagnostics, FileDiagnosticsWriter, readRecentDiagnostics } from "./diagnostics.js";

test("FileDiagnosticsWriter writes safe submit summaries without secrets or image data", () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-diag-"));
  try {
    const writer = new FileDiagnosticsWriter(join(dir, "diagnostics.log"));
    writer.record({
      surfaceId: "s1",
      status: "empty",
      providerProfile: "openai-compatible:gpt-test",
      inputSource: "imageData",
      originalSize: { width: 2000, height: 1000 },
      providerSize: { width: 1000, height: 500 },
      rawRegionCount: 0,
      finalRegionCount: 0,
      elapsedMs: 123,
      note: "data:image/png;base64,SECRET sk-test",
    });
    const text = readFileSync(join(dir, "diagnostics.log"), "utf8");
    assert.match(text, /"surfaceId":"s1"/);
    assert.doesNotMatch(text, /SECRET|sk-test|base64/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readRecentDiagnostics returns newest safe records first", () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-diag-read-"));
  try {
    const path = join(dir, "diagnostics.log");
    const writer = new FileDiagnosticsWriter(path);
    writer.record({ surfaceId: "old", status: "empty", providerProfile: "p", inputSource: "imageUrl", originalSize: { width: 1, height: 1 }, providerSize: { width: 1, height: 1 }, rawRegionCount: 0, finalRegionCount: 0, elapsedMs: 1 });
    writer.record({ surfaceId: "new", status: "completed", providerProfile: "p", inputSource: "imageData", originalSize: { width: 2, height: 2 }, providerSize: { width: 2, height: 2 }, rawRegionCount: 1, finalRegionCount: 1, elapsedMs: 2 });

    const recent = readRecentDiagnostics(path, 1);

    assert.equal(recent.length, 1);
    assert.equal(recent[0]?.surfaceId, "new");
    assert.equal(recent[0]?.status, "completed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("FileDiagnosticsWriter records filtered region counts", () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-diag-filtered-"));
  try {
    const writer = new FileDiagnosticsWriter(join(dir, "diagnostics.log"));
    writer.record({
      surfaceId: "s-filtered",
      status: "empty",
      providerProfile: "p",
      inputSource: "imageData",
      originalSize: { width: 100, height: 100 },
      providerSize: { width: 100, height: 100 },
      rawRegionCount: 2,
      finalRegionCount: 0,
      filteredRegionCount: 2,
      elapsedMs: 9,
      note: "filtered invalid boxes",
    });

    const text = readFileSync(join(dir, "diagnostics.log"), "utf8");
    assert.match(text, /"filteredRegionCount":2/);
    assert.match(text, /filtered invalid boxes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clearDiagnostics truncates diagnostics log and returns deleted bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-diag-clear-"));
  try {
    const path = join(dir, "diagnostics.log");
    const writer = new FileDiagnosticsWriter(path);
    writer.record({ surfaceId: "old", status: "empty", providerProfile: "p", inputSource: "imageUrl", originalSize: { width: 1, height: 1 }, providerSize: { width: 1, height: 1 }, rawRegionCount: 0, finalRegionCount: 0, elapsedMs: 1 });

    const deleted = clearDiagnostics(path);

    assert.equal(deleted > 0, true);
    assert.equal(readFileSync(path, "utf8"), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
