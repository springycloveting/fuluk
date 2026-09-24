import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLines, outputEtag, sanitizeTmuxName } from "../src/utils.mjs";

test("sanitizeTmuxName keeps safe names readable", () => {
  assert.equal(sanitizeTmuxName("sg-codex.main_1"), "sg-codex.main_1");
});

test("sanitizeTmuxName replaces unsafe characters", () => {
  assert.equal(sanitizeTmuxName("sg codex/中文:test"), "sg-codex-test");
});

test("normalizeLines clamps line count", () => {
  assert.equal(normalizeLines("0"), 1);
  assert.equal(normalizeLines("99999"), 2000);
  assert.equal(normalizeLines("abc"), 120);
});

test("outputEtag changes when output text or line count changes", () => {
  const first = outputEtag("hello", 120);
  assert.equal(outputEtag("hello", 120), first);
  assert.notEqual(outputEtag("hello!", 120), first);
  assert.notEqual(outputEtag("hello", 300), first);
});
