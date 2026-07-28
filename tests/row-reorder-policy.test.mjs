import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentModel } from "../src/document-model.mjs";
import { resolveCanReorderRows } from "../src/table/row-reorder-policy.mjs";

const emptyFilters = { topLevelRules: [], advancedRoot: null };

function availability(overrides = {}) {
  return resolveCanReorderRows({
    model: buildDocumentModel([{ id: "a" }, { id: "b" }], "json"),
    collectionPath: "$",
    query: "",
    filters: emptyFilters,
    sorts: [],
    ...overrides,
  });
}

test("row reorder is available for root and top-level arrays without project or file rules", () => {
  assert.equal(availability(), true);
  assert.equal(availability({
    model: buildDocumentModel({ entries: [{ id: "a" }, { id: "b" }] }, "json"),
    collectionPath: "entries",
  }), true);
  assert.equal(availability({
    model: buildDocumentModel(["a", "b"], "json"),
  }), true);
});

test("row reorder rejects record maps and non-array collection paths", () => {
  assert.equal(availability({
    model: buildDocumentModel({ alpha: { name: "A" }, beta: { name: "B" } }, "json"),
  }), false);
  assert.equal(availability({
    model: buildDocumentModel({ metadata: { version: 1 }, entries: [{ id: "a" }] }, "json"),
    collectionPath: "metadata",
  }), false);
});

test("row reorder is disabled by query, filters, sorts, and controlled states", () => {
  assert.equal(availability({ query: "alpha" }), false);
  assert.equal(availability({ filters: { topLevelRules: [{ field: "id" }], advancedRoot: null } }), false);
  assert.equal(availability({ filters: { topLevelRules: [], advancedRoot: { operator: "and", children: [] } } }), false);
  assert.equal(availability({ sorts: [{ field: "id", direction: "asc" }] }), false);
  for (const state of ["commandSaving", "closing", "rebuilding", "restarting"]) {
    assert.equal(availability({ [state]: true }), false, state);
  }
});
