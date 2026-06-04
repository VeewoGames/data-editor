import test from "node:test";
import assert from "node:assert/strict";
import {
  applyViewFilters,
  attachRowIndexes,
  matchesFilterRule,
} from "../src/view/filtering.mjs";

test("attachRowIndexes returns shallow copies with hidden runtime index", () => {
  const rows = [{ name: "Fire Rune" }, { name: "Water Rune" }];
  const indexed = attachRowIndexes(rows);

  assert.deepEqual(indexed.map((row) => ({ ...row })), [
    { name: "Fire Rune" },
    { name: "Water Rune" },
  ]);
  assert.deepEqual(indexed.map((row) => row.__rowIndex), [0, 1]);
  assert.notEqual(indexed[0], rows[0]);
  assert.equal(Object.keys(indexed[0]).includes("__rowIndex"), false);
});

test("applyViewFilters query scans values case-insensitively and ignores __rowIndex", () => {
  const rows = [
    { name: "Fire Rune", element: "Flame", __rowIndex: "fire" },
    { name: "Water Rune", element: "Aqua", __rowIndex: "match-only-index" },
  ];

  assert.deepEqual(applyViewFilters(rows, "flame", { op: "and", rules: [] }).map((row) => row.__rowIndex), [0]);
  assert.deepEqual(applyViewFilters(rows, "match-only-index", { op: "and", rules: [] }), []);
});

test("matchesFilterRule supports boolean is and is_not semantics", () => {
  assert.equal(matchesFilterRule({ enabled: true }, { field: "enabled", operator: "is", value: "true" }), true);
  assert.equal(matchesFilterRule({ enabled: false }, { field: "enabled", operator: "is_not", value: true }), true);
});

test("matchesFilterRule supports MultiSelect contains and does_not_contain", () => {
  const row = { tags: ["fire", "rare"] };

  assert.equal(matchesFilterRule(row, { field: "tags", operator: "contains", value: "rare" }), true);
  assert.equal(matchesFilterRule(row, { field: "tags", operator: "contains", value: ["ice", "fire"] }), true);
  assert.equal(matchesFilterRule(row, { field: "tags", operator: "does_not_contain", value: "ice" }), true);
});

test("matchesFilterRule leaves new value-required filters inactive until a value is selected", () => {
  const rows = [
    { name: "Fire Rune", enabled: true, tags: ["fire"] },
    { name: "Ice Rune", enabled: false, tags: ["ice"] },
  ];

  assert.deepEqual(applyViewFilters(rows, "", {
    op: "and",
    rules: [{ field: "tags", operator: "contains", value: [] }],
  }).map((row) => row.name), ["Fire Rune", "Ice Rune"]);
  assert.equal(matchesFilterRule(rows[0], { field: "tags", operator: "does_not_contain", value: [] }), true);
  assert.equal(matchesFilterRule(rows[1], { field: "enabled", operator: "is" }), true);
  assert.equal(matchesFilterRule(rows[1], { field: "enabled", operator: "is_not", value: "" }), true);
});

test("matchesFilterRule supports empty and not empty values", () => {
  assert.equal(matchesFilterRule({ notes: "" }, { field: "notes", operator: "is_empty" }), true);
  assert.equal(matchesFilterRule({ tags: [] }, { field: "tags", operator: "is_empty" }), true);
  assert.equal(matchesFilterRule({ notes: "ready" }, { field: "notes", operator: "is_not_empty" }), true);
});

test("applyViewFilters applies all rules and returns indexed shallow copies", () => {
  const rows = [
    { name: "Fire Rune", enabled: true, tags: ["fire"] },
    { name: "Ice Rune", enabled: true, tags: ["ice"] },
    { name: "Hidden Fire", enabled: false, tags: ["fire"] },
  ];
  const filtered = applyViewFilters(rows, "fire", {
    op: "and",
    rules: [
      { field: "enabled", operator: "is", value: true },
      { field: "tags", operator: "contains", value: "fire" },
    ],
  });

  assert.deepEqual(filtered.map((row) => ({ ...row })), [
    { name: "Fire Rune", enabled: true, tags: ["fire"] },
  ]);
  assert.deepEqual(filtered.map((row) => row.__rowIndex), [0]);
  assert.equal(Object.keys(filtered[0]).includes("__rowIndex"), false);
  assert.notEqual(filtered[0], rows[0]);
});

test("applyViewFilters preserves existing enumerable row indexes", () => {
  const rows = [
    { name: "Hidden", __rowIndex: 7 },
    { name: "Visible", __rowIndex: 3 },
  ];

  assert.deepEqual(
    applyViewFilters(rows, "visible", { op: "and", rules: [] }).map((row) => row.__rowIndex),
    [3],
  );
});

test("applyViewFilters treats unsupported filter op values as AND", () => {
  const rows = [
    { name: "Fire Rune", enabled: true, tags: ["fire"] },
    { name: "Ice Rune", enabled: true, tags: ["ice"] },
    { name: "Hidden Fire", enabled: false, tags: ["fire"] },
  ];

  assert.deepEqual(applyViewFilters(rows, "", {
    op: "or",
    rules: [
      { field: "enabled", operator: "is", value: true },
      { field: "tags", operator: "contains", value: "fire" },
    ],
  }).map((row) => row.name), ["Fire Rune"]);
});
