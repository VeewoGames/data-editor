import test from "node:test";
import assert from "node:assert/strict";
import { shouldPreserveEntryActionFeedback } from "../src/entry-action-feedback-context.ts";

test("shouldPreserveEntryActionFeedback keeps status when reopening the same entry by rowId", () => {
  assert.equal(
    shouldPreserveEntryActionFeedback(
      {
        sourcePath: "data/skills.json",
        collectionPath: "skills",
        rowId: "entry-1",
        sourceRowIndex: 4,
      },
      {
        sourcePath: "data/skills.json",
        collectionPath: "skills",
        rowId: "entry-1",
        sourceRowIndex: 4,
      },
    ),
    true,
  );
});

test("shouldPreserveEntryActionFeedback falls back to sourceRowIndex when rowId is unavailable", () => {
  assert.equal(
    shouldPreserveEntryActionFeedback(
      {
        sourcePath: "data/skills.json",
        collectionPath: "$",
        rowId: null,
        sourceRowIndex: 2,
      },
      {
        sourcePath: "data/skills.json",
        collectionPath: "$",
        rowId: null,
        sourceRowIndex: 2,
      },
    ),
    true,
  );
});

test("shouldPreserveEntryActionFeedback resets status when switching to another entry", () => {
  assert.equal(
    shouldPreserveEntryActionFeedback(
      {
        sourcePath: "data/skills.json",
        collectionPath: "skills",
        rowId: "entry-1",
        sourceRowIndex: 4,
      },
      {
        sourcePath: "data/skills.json",
        collectionPath: "skills",
        rowId: "entry-2",
        sourceRowIndex: 5,
      },
    ),
    false,
  );
});

test("shouldPreserveEntryActionFeedback resets status when switching file or collection", () => {
  assert.equal(
    shouldPreserveEntryActionFeedback(
      {
        sourcePath: "data/skills.json",
        collectionPath: "skills",
        rowId: "entry-1",
        sourceRowIndex: 4,
      },
      {
        sourcePath: "data/traits.json",
        collectionPath: "traits",
        rowId: "entry-1",
        sourceRowIndex: 4,
      },
    ),
    false,
  );
});
