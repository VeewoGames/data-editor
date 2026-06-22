import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSelectionRect,
  isCellInsideRect,
  resolveClearValueByDisplayType,
  buildOptionFieldClearPatch,
} from "../src/table/table-selection.mjs";

test("buildSelectionRect normalizes drag direction", () => {
  const rect = buildSelectionRect(
    { visibleRowIndex: 5, visibleColumnIndex: 4 },
    { visibleRowIndex: 2, visibleColumnIndex: 1 },
  );
  assert.deepEqual(rect, {
    rowStart: 2,
    rowEnd: 5,
    columnStart: 1,
    columnEnd: 4,
  });
});

test("isCellInsideRect matches inclusive rectangle bounds", () => {
  const rect = { rowStart: 2, rowEnd: 5, columnStart: 1, columnEnd: 4 };
  assert.equal(isCellInsideRect(rect, { visibleRowIndex: 2, visibleColumnIndex: 1 }), true);
  assert.equal(isCellInsideRect(rect, { visibleRowIndex: 5, visibleColumnIndex: 4 }), true);
  assert.equal(isCellInsideRect(rect, { visibleRowIndex: 6, visibleColumnIndex: 4 }), false);
});

test("resolveClearValueByDisplayType uses agreed first-pass clear semantics", () => {
  assert.equal(resolveClearValueByDisplayType("Text"), "");
  assert.equal(resolveClearValueByDisplayType("Number"), "");
  assert.equal(resolveClearValueByDisplayType("Checkbox"), false);
  assert.equal(resolveClearValueByDisplayType("Select"), null);
  assert.deepEqual(resolveClearValueByDisplayType("Multi-select"), []);
  assert.equal(resolveClearValueByDisplayType("Relation"), undefined);
});

test("buildOptionFieldClearPatch clears single and multi selected values without changing option definitions", () => {
  const options = [{ value: "burn", label: "Burn", color: "orange" }];
  assert.deepEqual(
    buildOptionFieldClearPatch({
      mode: "single",
      options,
      selectedValues: ["burn"],
    }),
    {
      createdOptionValues: [],
      deletedOptionValues: [],
      nextOptionOrder: ["burn"],
      nextOptions: options,
      nextSelectedValues: [],
      optionsChanged: false,
      orderChanged: false,
      renamedOptions: [],
      valueChanged: true,
    },
  );
});
