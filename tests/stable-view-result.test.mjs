import assert from "node:assert/strict";
import test from "node:test";
import { stabilizeViewResult } from "../src/view/stable-view-result.mjs";

test("stabilizeViewResult reuses row id arrays when contents stay identical", () => {
  const previous = {
    sourceRows: [],
    candidateRows: [],
    searchRows: [],
    filteredRows: [],
    visibleRows: [],
    sourceOrderRowIds: ["a", "b"],
    candidateRowIds: null,
    searchRowIds: ["a", "b"],
    filteredRowIds: ["a"],
    visibleRowIds: ["a"],
  };
  const next = {
    ...previous,
    sourceOrderRowIds: ["a", "b"],
    searchRowIds: ["a", "b"],
    filteredRowIds: ["a"],
    visibleRowIds: ["a"],
  };

  const stabilized = stabilizeViewResult(previous, next);
  assert.equal(stabilized.sourceOrderRowIds, previous.sourceOrderRowIds);
  assert.equal(stabilized.searchRowIds, previous.searchRowIds);
  assert.equal(stabilized.filteredRowIds, previous.filteredRowIds);
  assert.equal(stabilized.visibleRowIds, previous.visibleRowIds);
});

test("stabilizeViewResult keeps new arrays when row id contents change", () => {
  const previous = {
    sourceRows: [],
    candidateRows: [],
    searchRows: [],
    filteredRows: [],
    visibleRows: [],
    sourceOrderRowIds: ["a", "b"],
    candidateRowIds: null,
    searchRowIds: ["a", "b"],
    filteredRowIds: ["a"],
    visibleRowIds: ["a"],
  };
  const next = {
    ...previous,
    visibleRowIds: ["b"],
  };

  const stabilized = stabilizeViewResult(previous, next);
  assert.equal(stabilized.visibleRowIds, next.visibleRowIds);
});
