import test from "node:test";
import assert from "node:assert/strict";
import { findTitleField } from "../src/model/titleField.ts";

test("findTitleField prefers configured collection title field", () => {
  assert.equal(
    findTitleField(["name", "category", "id"], [{ name: "Select One", category: "attack", id: "1" }], "category"),
    "category",
  );
});

test("findTitleField falls back to heuristics when configured field is missing", () => {
  assert.equal(
    findTitleField(["name", "category", "id"], [{ name: "Select One", category: "attack", id: "1" }], "missing_field"),
    "name",
  );
});
