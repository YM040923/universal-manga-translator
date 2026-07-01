import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("content script build is a classic script without static module imports", () => {
  const content = readFileSync(resolve("dist/content.js"), "utf8");
  assert.equal(/(^|[;\n\r])\s*import\s*(?:\{|[\w*])/m.test(content), false);
});