import test from "node:test";
import assert from "node:assert/strict";
import {
  hasExceededRowDragThreshold,
  isPreciseRowDragPointer,
  reorderRowIds,
  resolveRowAutoScrollDelta,
  resolveRowDropTarget,
} from "../src/table/row-dnd.mjs";

const rowRects = [
  { rowId: "a", top: 100, bottom: 140 },
  { rowId: "b", top: 140, bottom: 180 },
  { rowId: "c", top: 180, bottom: 220 },
];
const rowIds = ["a", "b", "c"];
const containerRect = { left: 20, right: 500, top: 80, bottom: 240 };

test("row drag accepts precise mouse and pen pointers but rejects touch", () => {
  assert.equal(isPreciseRowDragPointer("mouse"), true);
  assert.equal(isPreciseRowDragPointer("pen"), true);
  assert.equal(isPreciseRowDragPointer("touch"), false);
});

test("row drag starts only after moving beyond four pixels", () => {
  assert.equal(hasExceededRowDragThreshold(10, 10, 14, 10), false);
  assert.equal(hasExceededRowDragThreshold(10, 10, 14.1, 10), true);
});

test("row drop target resolves before and after while suppressing no-op placements", () => {
  assert.deepEqual(resolveRowDropTarget({ sourceRowId: "c", pointerX: 100, pointerY: 110, containerRect, rowRects, rowIds }), {
    rowId: "a",
    placement: "before",
  });
  assert.deepEqual(resolveRowDropTarget({ sourceRowId: "a", pointerX: 100, pointerY: 210, containerRect, rowRects, rowIds }), {
    rowId: "c",
    placement: "after",
  });
  assert.equal(resolveRowDropTarget({ sourceRowId: "a", pointerX: 100, pointerY: 145, containerRect, rowRects, rowIds }), null);
  assert.equal(resolveRowDropTarget({ sourceRowId: "b", pointerX: 100, pointerY: 160, containerRect, rowRects, rowIds }), null);
});

test("row drop target clears outside every container edge instead of clamping stale targets", () => {
  for (const point of [
    { pointerX: 19, pointerY: 120 },
    { pointerX: 501, pointerY: 120 },
    { pointerX: 100, pointerY: 79 },
    { pointerX: 100, pointerY: 241 },
  ]) {
    assert.equal(resolveRowDropTarget({
      sourceRowId: "c",
      containerRect,
      rowRects,
      rowIds,
      ...point,
    }), null);
  }
});

test("row auto-scroll accelerates toward the 48px top and bottom edges", () => {
  assert.equal(resolveRowAutoScrollDelta({ pointerY: 150, containerTop: 100, containerBottom: 400 }), 0);
  assert.ok(resolveRowAutoScrollDelta({ pointerY: 130, containerTop: 100, containerBottom: 400 }) < 0);
  assert.ok(resolveRowAutoScrollDelta({ pointerY: 101, containerTop: 100, containerBottom: 400 })
    < resolveRowAutoScrollDelta({ pointerY: 130, containerTop: 100, containerBottom: 400 }));
  assert.ok(resolveRowAutoScrollDelta({ pointerY: 399, containerTop: 100, containerBottom: 400 })
    > resolveRowAutoScrollDelta({ pointerY: 380, containerTop: 100, containerBottom: 400 }));
});

test("row id preview order matches before and after placement", () => {
  assert.deepEqual(reorderRowIds(rowIds, "a", "c", "after"), ["b", "c", "a"]);
  assert.deepEqual(reorderRowIds(rowIds, "c", "a", "before"), ["c", "a", "b"]);
});
