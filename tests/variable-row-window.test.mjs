import assert from "node:assert/strict";
import test from "node:test";
import { mergeMeasuredRowHeights, resolveRowHeight } from "../src/table/row-height-index.mjs";
import { buildVariableRowWindow } from "../src/table/variable-row-window.mjs";

test("buildVariableRowWindow returns a bounded window for uniform heights", () => {
  const rowIds = Array.from({ length: 100 }, (_, index) => `row-${index}`);
  const result = buildVariableRowWindow({
    rowIds,
    viewportHeight: 72,
    scrollTop: 72,
    overscan: 1,
    getRowHeight: () => 36,
  });

  assert.deepEqual(result, {
    windowStart: 1,
    windowEnd: 5,
    topSpacerHeight: 36,
    bottomSpacerHeight: 3420,
    totalHeight: 3600,
  });
});

test("buildVariableRowWindow handles mixed heights and preserves spacer totals", () => {
  const rowIds = ["a", "b", "c", "d", "e"];
  const heights = { a: 50, b: 70, c: 90, d: 110, e: 130 };
  const result = buildVariableRowWindow({
    rowIds,
    viewportHeight: 120,
    scrollTop: 130,
    overscan: 1,
    getRowHeight: (rowId) => heights[rowId],
  });

  assert.equal(result.windowStart, 1);
  assert.equal(result.windowEnd, 5);
  assert.equal(result.topSpacerHeight, 50);
  assert.equal(result.bottomSpacerHeight, 0);
  assert.equal(result.totalHeight, 450);
});

test("row height index helpers prefer measured heights and merge without churn", () => {
  const previous = { "row-1": 88.12 };
  assert.equal(resolveRowHeight("row-1", previous, 72), 88.12);
  assert.equal(resolveRowHeight("row-2", previous, 72), 72);
  assert.equal(mergeMeasuredRowHeights(previous, { "row-1": 88.121 }), previous);
  assert.deepEqual(mergeMeasuredRowHeights(previous, { "row-2": 91.4 }), {
    "row-1": 88.12,
    "row-2": 91.4,
  });
});
