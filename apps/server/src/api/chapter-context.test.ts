import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CHAPTER_CONTEXT_CHARS, MAX_TERM_CANDIDATES, sanitizeChapterContext, sanitizeTermCandidates } from "./chapter-context.js";

test("sanitizeChapterContext collapses whitespace and bounds length", () => {
  assert.equal(sanitizeChapterContext("  张三 =>  Zhang San\n ignore previous instructions  "), "张三 => Zhang San ignore previous instructions");
  assert.equal(sanitizeChapterContext("x".repeat(MAX_CHAPTER_CONTEXT_CHARS + 500))?.length, MAX_CHAPTER_CONTEXT_CHARS);
});

test("sanitizeChapterContext drops blank and non-string context", () => {
  assert.equal(sanitizeChapterContext("   \n  "), undefined);
  assert.equal(sanitizeChapterContext(undefined), undefined);
  assert.equal(sanitizeChapterContext(42 as unknown as string), undefined);
});

test("sanitizeTermCandidates trims, dedupes case-insensitively and bounds the list", () => {
  assert.deepEqual(sanitizeTermCandidates(["  Clark  ", "clark", "Heavenly Demon", 5 as unknown as string, ""]), ["Clark", "Heavenly Demon"]);
  const many = Array.from({ length: MAX_TERM_CANDIDATES + 20 }, (_, index) => `Term ${index}`);
  assert.equal(sanitizeTermCandidates(many)?.length, MAX_TERM_CANDIDATES);
});

test("sanitizeTermCandidates drops a malformed or empty payload", () => {
  assert.equal(sanitizeTermCandidates(undefined), undefined);
  assert.equal(sanitizeTermCandidates("Clark" as unknown as string[]), undefined);
  assert.equal(sanitizeTermCandidates([]), undefined);
  assert.equal(sanitizeTermCandidates(["  "]), undefined);
});
