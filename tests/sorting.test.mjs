import test from "node:test";
import assert from "node:assert/strict";
import { applyViewSorts, compareFieldValue, updateHeaderSorts } from "../src/view/sorting.mjs";

test("applyViewSorts returns original array when sorts are empty", () => {
  const rows = [{ name: "B" }, { name: "A" }];

  assert.equal(applyViewSorts(rows, []), rows);
  assert.equal(applyViewSorts(rows, null), rows);
});

test("applyViewSorts sorts ascending and descending without cloning row objects", () => {
  const rows = [
    { name: "B", __rowIndex: 0 },
    { name: "A", __rowIndex: 1 },
    { name: "C", __rowIndex: 2 },
  ];
  const asc = applyViewSorts(rows, [{ field: "name", direction: "asc" }]);
  const desc = applyViewSorts(rows, [{ field: "name", direction: "desc" }]);

  assert.notEqual(asc, rows);
  assert.deepEqual(asc.map((row) => row.name), ["A", "B", "C"]);
  assert.equal(asc[0], rows[1]);
  assert.deepEqual(desc.map((row) => row.name), ["C", "B", "A"]);
});

test("applyViewSorts supports multiple fields", () => {
  const rows = [
    { rarity: "rare", name: "B" },
    { rarity: "common", name: "C" },
    { rarity: "common", name: "A" },
  ];

  assert.deepEqual(applyViewSorts(rows, [
    { field: "rarity", direction: "asc" },
    { field: "name", direction: "asc" },
  ]).map((row) => row.name), ["A", "C", "B"]);
});

test("compareFieldValue uses numeric string comparison", () => {
  assert.equal(compareFieldValue("2", "10", "asc") < 0, true);
  assert.equal(compareFieldValue("2", "10", "desc") > 0, true);
});

test("applyViewSorts uses configured option order for select fields", () => {
  const rows = [
    { rarity: "rare", __rowIndex: 0 },
    { rarity: "magic", __rowIndex: 1 },
    { rarity: "epic", __rowIndex: 2 },
  ];

  assert.deepEqual(
    applyViewSorts(
      rows,
      [{ field: "rarity", direction: "asc" }],
      { rarity: "Select" },
      { rarity: ["magic", "rare", "epic", "legendary"] },
    ).map((row) => row.rarity),
    ["magic", "rare", "epic"],
  );
});

test("applyViewSorts uses configured option order for multi-select fields", () => {
  const rows = [
    { tags: ["epic"], __rowIndex: 0 },
    { tags: ["rare"], __rowIndex: 1 },
    { tags: ["magic", "epic"], __rowIndex: 2 },
  ];

  assert.deepEqual(
    applyViewSorts(
      rows,
      [{ field: "tags", direction: "asc" }],
      { tags: "Multi-select" },
      { tags: ["magic", "rare", "epic", "legendary"] },
    ).map((row) => row.tags),
    [["magic", "epic"], ["rare"], ["epic"]],
  );
});

test("applyViewSorts uses configured option order for relation fields", () => {
  const rows = [
    { parent_id: "rare", __rowIndex: 0 },
    { parent_id: "magic", __rowIndex: 1 },
    { parent_id: "epic", __rowIndex: 2 },
  ];

  assert.deepEqual(
    applyViewSorts(
      rows,
      [{ field: "parent_id", direction: "asc" }],
      { parent_id: "Relation" },
      { parent_id: ["magic", "rare", "epic", "legendary"] },
    ).map((row) => row.parent_id),
    ["magic", "rare", "epic"],
  );
});

test("applyViewSorts keeps empty values last in both directions", () => {
  const rows = [
    { name: null },
    { name: "B" },
    { name: "" },
    { name: "A" },
  ];

  assert.deepEqual(applyViewSorts(rows, [{ field: "name", direction: "asc" }]).map((row) => row.name), ["A", "B", null, ""]);
  assert.deepEqual(applyViewSorts(rows, [{ field: "name", direction: "desc" }]).map((row) => row.name), ["B", "A", null, ""]);
});

test("applyViewSorts preserves row indexes through sorted order", () => {
  const rows = [
    { name: "B", __rowIndex: 0 },
    { name: "A", __rowIndex: 1 },
  ];

  assert.deepEqual(applyViewSorts(rows, [{ field: "name", direction: "asc" }]).map((row) => row.__rowIndex), [1, 0]);
});

test("updateHeaderSorts updates one field while preserving other sorts", () => {
  const sorts = [
    { id: "sort:rarity", field: "rarity", direction: "asc" },
    { id: "sort:name", field: "name", direction: "desc" },
  ];

  assert.deepEqual(updateHeaderSorts(sorts, "name", "asc"), [
    { id: "sort:rarity", field: "rarity", direction: "asc" },
    { id: "sort:name", field: "name", direction: "asc" },
  ]);
  assert.deepEqual(updateHeaderSorts(sorts, "name", null), [
    { id: "sort:rarity", field: "rarity", direction: "asc" },
  ]);
  assert.deepEqual(updateHeaderSorts(sorts, "power", "desc"), [
    { id: "sort:rarity", field: "rarity", direction: "asc" },
    { id: "sort:name", field: "name", direction: "desc" },
    { id: "sort:power", field: "power", direction: "desc" },
  ]);
});
