import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStreamlineTags } from "../../scripts/streamline-export/lib/streamline-tag-normalization.mjs";

test("normalizeStreamlineTags strips fenced-code wrappers and collapses whitespace", () => {
  assert.deepEqual(
    normalizeStreamlineTags([
      "```plaintext\ncall",
      " alert ",
      "",
      null,
      "attention\n```",
      "multi\nword",
    ]),
    ["call", "alert", "attention", "multi word"],
  );
});

test("normalizeStreamlineTags can lowercase while deduplicating", () => {
  assert.deepEqual(
    normalizeStreamlineTags([" Chat ", "chat", "```plaintext\nCHAT\n```"], { lowercase: true }),
    ["chat"],
  );
});
