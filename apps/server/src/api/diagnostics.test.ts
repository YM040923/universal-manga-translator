import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileDiagnosticsWriter } from "./diagnostics.js";

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
