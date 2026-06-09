import assert from "node:assert/strict";
import test from "node:test";
import { buildVisibleTableRenderContract } from "../src/table/table-render-contract.mjs";

test("buildVisibleTableRenderContract returns worker-ready visible rows with stable ids and source indexes", () => {
  const contract = buildVisibleTableRenderContract({
    rowViews: [
      { rowId: "row-a", sourceIndex: 12, row: { name: "Fireball" } },
      { rowId: "row-b", sourceIndex: null, row: { name: "Icebolt" } },
    ],
    windowStart: 40,
  });

  assert.equal(contract.rowCount, 2);
  assert.equal(contract.windowStart, 40);
  assert.deepEqual(contract.rowIds, ["row-a", "row-b"]);
  assert.deepEqual(
    contract.rows.map((row) => ({ rowId: row.__rowId, rowIndex: row.__rowIndex, name: row.name })),
    [
      { rowId: "row-a", rowIndex: 12, name: "Fireball" },
      { rowId: "row-b", rowIndex: 41, name: "Icebolt" },
    ],
  );
});

test("buildVisibleTableRenderContract reuses previous row objects when row payload and source index stay stable", () => {
  const previous = buildVisibleTableRenderContract({
    rowViews: [
      { rowId: "row-a", sourceIndex: 12, row: { name: "Fireball" } },
      { rowId: "row-b", sourceIndex: 13, row: { name: "Icebolt" } },
    ],
    windowStart: 40,
  });

  const next = buildVisibleTableRenderContract({
    rowViews: [
      { rowId: "row-a", sourceIndex: 12, row: { name: "Fireball" } },
      { rowId: "row-b", sourceIndex: 13, row: { name: "Icebolt" } },
    ],
    windowStart: 40,
    previousContract: previous,
  });

  assert.equal(next.rows[0], previous.rows[0]);
  assert.equal(next.rows[1], previous.rows[1]);

  const changed = buildVisibleTableRenderContract({
    rowViews: [
      { rowId: "row-a", sourceIndex: 12, row: { name: "Fireball+" } },
      { rowId: "row-b", sourceIndex: 13, row: { name: "Icebolt" } },
    ],
    windowStart: 40,
    previousContract: next,
  });

  assert.notEqual(changed.rows[0], next.rows[0]);
  assert.equal(changed.rows[1], next.rows[1]);
});
