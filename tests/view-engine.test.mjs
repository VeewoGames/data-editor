import test from "node:test";
import assert from "node:assert/strict";
import { runSearch } from "../src/view/search-engine.mjs";
import { runView } from "../src/view/view-engine.mjs";

const fieldTypes = {
  enabled: "Checkbox",
  tags: "Multi-select",
};

test("runSearch treats null candidates as all source rows and empty candidates as explicit none", () => {
  const rows = [
    { rowId: "row-3", sourceOrder: 2, row: { name: "Ice Rune", enabled: true } },
    { rowId: "row-1", sourceOrder: 0, row: { name: "Fire Rune", enabled: true } },
    { rowId: "row-2", sourceOrder: 1, row: { name: "Plain Stone", enabled: false } },
  ];

  const allCandidates = runSearch({ rows, query: "rune", candidateRowIds: null });
  assert.deepEqual(allCandidates.sourceOrderRowIds, ["row-1", "row-2", "row-3"]);
  assert.equal(allCandidates.candidateRowIds, null);
  assert.deepEqual(allCandidates.searchRowIds, ["row-1", "row-3"]);

  const noCandidates = runSearch({ rows, query: "rune", candidateRowIds: [] });
  assert.deepEqual(noCandidates.sourceOrderRowIds, ["row-1", "row-2", "row-3"]);
  assert.deepEqual(noCandidates.candidateRowIds, []);
  assert.deepEqual(noCandidates.searchRowIds, []);
});

test("runSearch applies candidate subsets after sourceOrder instead of caller order", () => {
  const rows = [
    { rowId: "row-3", sourceOrder: 2, row: { name: "Ice Rune" } },
    { rowId: "row-1", sourceOrder: 0, row: { name: "Fire Rune" } },
    { rowId: "row-2", sourceOrder: 1, row: { name: "Plain Stone" } },
  ];

  const result = runSearch({
    rows,
    query: "",
    candidateRowIds: ["row-3", "row-1"],
  });

  assert.deepEqual(result.sourceOrderRowIds, ["row-1", "row-2", "row-3"]);
  assert.deepEqual(result.candidateRowIds, ["row-1", "row-3"]);
  assert.deepEqual(result.searchRowIds, ["row-1", "row-3"]);
});

test("runView processes sourceOrder, candidates, query, filters, then sorts into visibleRowIds", () => {
  const rows = [
    { rowId: "row-4", sourceOrder: 3, row: { name: "Zephyr Rune", enabled: true, tags: ["fire"] } },
    { rowId: "row-2", sourceOrder: 1, row: { name: "Blaze Rune", enabled: false, tags: ["fire"] } },
    { rowId: "row-1", sourceOrder: 0, row: { name: "Amber Stone", enabled: true, tags: ["earth"] } },
    { rowId: "row-3", sourceOrder: 2, row: { name: "Alpha Rune", enabled: true, tags: ["fire"] } },
  ];

  const result = runView({
    rows,
    query: "rune",
    candidateRowIds: ["row-4", "missing", "row-2", "row-3"],
    filters: {
      op: "and",
      rules: [
        { field: "enabled", operator: "is", value: true },
        { field: "tags", operator: "contains", value: "fire" },
      ],
    },
    sorts: [{ id: "sort:name", field: "name", direction: "desc" }],
    fieldTypes,
  });

  assert.deepEqual(result.sourceOrderRowIds, ["row-1", "row-2", "row-3", "row-4"]);
  assert.deepEqual(result.candidateRowIds, ["row-2", "row-3", "row-4"]);
  assert.deepEqual(result.searchRowIds, ["row-2", "row-3", "row-4"]);
  assert.deepEqual(result.filteredRowIds, ["row-3", "row-4"]);
  assert.deepEqual(result.visibleRowIds, ["row-4", "row-3"]);
});
