import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIconSlugToFilename } from "../../scripts/streamline-export/lib/normalize-name.mjs";

test("normalizeIconSlugToFilename keeps stable kebab slugs", () => {
  assert.equal(normalizeIconSlugToFilename("attachment-1"), "attachment-1.svg");
  assert.equal(normalizeIconSlugToFilename("edit-write-circle"), "edit-write-circle.svg");
});

test("normalizeIconSlugToFilename strips unsafe characters", () => {
  assert.equal(normalizeIconSlugToFilename(" Attachment 1 "), "attachment-1.svg");
  assert.equal(normalizeIconSlugToFilename("A/B:C"), "a-b-c.svg");
});
