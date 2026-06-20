import test from "node:test";
import assert from "node:assert/strict";
import {
  applyViewFilters,
  attachRowIndexes,
  matchesFilterRule,
} from "../src/view/filtering.mjs";

const discreteFieldTypes = {
  category: "Select",
  skill_id: "Relation",
  tags: "Multi-select",
  notes: "Text",
};

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

test("applyViewFilters returns original rows when query and filters are empty", () => {
  const rows = [
    { name: "Fire Rune" },
    { name: "Water Rune" },
  ];

  const filtered = applyViewFilters(rows, "", { op: "and", rules: [] }, discreteFieldTypes);
  assert.equal(filtered, rows);
  assert.equal(filtered[0], rows[0]);
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

test("matchesFilterRule uses exact matching for discrete scalar fields when filter values are arrays", () => {
  const row = {
    category: "attack",
    skill_id: "skill_slash",
    notes: "attack skill",
  };

  assert.equal(matchesFilterRule(row, { field: "category", operator: "contains", value: ["attack"] }, discreteFieldTypes), true);
  assert.equal(matchesFilterRule(row, { field: "category", operator: "contains", value: ["att"] }, discreteFieldTypes), false);
  assert.equal(matchesFilterRule(row, { field: "skill_id", operator: "does_not_contain", value: ["skill"] }, discreteFieldTypes), true);
  assert.equal(matchesFilterRule(row, { field: "notes", operator: "contains", value: "att" }, discreteFieldTypes), true);
});

test("matchesFilterRule keeps exact matching for persisted scalar values on Select and Relation filters", () => {
  const row = {
    category: "attack",
    skill_id: "skill_slash",
    notes: "skill_slash attack",
  };

  assert.equal(matchesFilterRule(row, { field: "category", operator: "contains", value: "attack" }, discreteFieldTypes), true);
  assert.equal(matchesFilterRule(row, { field: "category", operator: "contains", value: "att" }, discreteFieldTypes), false);
  assert.equal(matchesFilterRule(row, { field: "skill_id", operator: "contains", value: "skill_slash" }, discreteFieldTypes), true);
  assert.equal(matchesFilterRule(row, { field: "skill_id", operator: "contains", value: "skill" }, discreteFieldTypes), false);
  assert.equal(matchesFilterRule(row, { field: "notes", operator: "contains", value: "skill" }, discreteFieldTypes), true);
});

test("matchesFilterRule leaves new value-required filters inactive until a value is selected", () => {
  const rows = [
    { name: "Fire Rune", enabled: true, tags: ["fire"] },
    { name: "Ice Rune", enabled: false, tags: ["ice"] },
  ];

  assert.deepEqual(applyViewFilters(rows, "", {
    op: "and",
    rules: [{ field: "tags", operator: "contains", value: [] }],
  }, discreteFieldTypes).map((row) => row.name), ["Fire Rune", "Ice Rune"]);
  assert.equal(matchesFilterRule(rows[0], { field: "tags", operator: "does_not_contain", value: [] }, discreteFieldTypes), true);
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
  }, discreteFieldTypes);

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
    applyViewFilters(rows, "visible", { op: "and", rules: [] }, discreteFieldTypes).map((row) => row.__rowIndex),
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
  }, discreteFieldTypes).map((row) => row.name), ["Fire Rune"]);
});

test("applyViewFilters matches topLevelRules and advancedRoot together", () => {
  const rows = [
    { owner: "player", skill_category: "general", dev_status: "草稿" },
    { owner: "player", skill_category: "general", dev_status: "完成" },
  ];

  const filtered = applyViewFilters(rows, "", {
    topLevelRules: [{ kind: "rule", id: "owner", field: "owner", operator: "is", value: "player" }],
    advancedRoot: {
      kind: "group",
      id: "advanced-root",
      op: "and",
      children: [
        { kind: "rule", id: "general", field: "skill_category", operator: "is", value: "general" },
        { kind: "rule", id: "not-draft", field: "dev_status", operator: "is_not", value: "草稿" },
      ],
    },
  }, discreteFieldTypes);

  assert.deepEqual(filtered.map((row) => row.dev_status), ["完成"]);
});

test("applyViewFilters supports mixed child joins inside one advanced group", () => {
  const rows = [
    { owner: "player", skill_category: "general", type: "spell" },
    { owner: "enemy", skill_category: "general", type: "spell" },
    { owner: "enemy", skill_category: "general", type: "attack" },
  ];

  const filtered = applyViewFilters(rows, "", {
    topLevelRules: [],
    advancedRoot: {
      kind: "group",
      id: "advanced-root",
      op: "and",
      children: [
        { kind: "rule", id: "owner", field: "owner", operator: "is", value: "player" },
        { kind: "rule", id: "category", field: "skill_category", operator: "is", value: "general", join: "or" },
        { kind: "rule", id: "type", field: "type", operator: "is", value: "spell", join: "and" },
      ],
    },
  }, discreteFieldTypes);

  assert.deepEqual(filtered.map((row) => row.type), ["spell", "spell"]);
});

test("applyViewFilters allows duplicate-field rules", () => {
  const rows = [{ skill_category: "general" }, { skill_category: "summon" }];

  const filtered = applyViewFilters(rows, "", {
    topLevelRules: [
      { kind: "rule", id: "a", field: "skill_category", operator: "is", value: "general" },
      { kind: "rule", id: "b", field: "skill_category", operator: "is_not", value: "summon" },
    ],
    advancedRoot: null,
  }, discreteFieldTypes);

  assert.equal(filtered.length, 1);
});
