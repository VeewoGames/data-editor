import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMultiSelectFieldConfig,
  buildMultiSelectFieldConfigFromRows,
  buildOptionConfigFromOptions,
  buildOptionConfigByOrder,
  removeMultiSelectOptionFromRows,
  renameOptionConfigValue,
  removeSingleSelectOptionFromRows,
  renameMultiSelectOptionInRows,
  renameSingleSelectOptionInRows,
  sortValuesByOptionOrder,
} from "../src/multiselect-config.mjs";

test("renameMultiSelectOptionInRows updates every matching value in one field", () => {
  const rows = [
    { id: "1", features: ["attack", "spell"], other: ["attack"] },
    { id: "2", features: ["attack"] },
  ];
  renameMultiSelectOptionInRows(rows, "features", "attack", "strike");
  assert.deepEqual(rows, [
    { id: "1", features: ["strike", "spell"], other: ["attack"] },
    { id: "2", features: ["strike"] },
  ]);
});

test("removeMultiSelectOptionFromRows removes only the targeted option", () => {
  const rows = [
    { id: "1", features: ["attack", "spell"] },
    { id: "2", features: ["attack"] },
    { id: "3", features: "attack" },
  ];
  removeMultiSelectOptionFromRows(rows, "features", "attack");
  assert.deepEqual(rows, [
    { id: "1", features: ["spell"] },
    { id: "2", features: [] },
    { id: "3", features: "attack" },
  ]);
});

test("renameSingleSelectOptionInRows updates matching scalar values only in one field", () => {
  const rows = [
    { id: "1", category: "attack", other: "attack" },
    { id: "2", category: "spell" },
  ];
  renameSingleSelectOptionInRows(rows, "category", "attack", "strike");
  assert.deepEqual(rows, [
    { id: "1", category: "strike", other: "attack" },
    { id: "2", category: "spell" },
  ]);
});

test("removeSingleSelectOptionFromRows clears matching scalar values only in one field", () => {
  const rows = [
    { id: "1", category: "attack" },
    { id: "2", category: "spell" },
    { id: "3", category: ["attack"] },
  ];
  removeSingleSelectOptionFromRows(rows, "category", "attack");
  assert.deepEqual(rows, [
    { id: "1", category: null },
    { id: "2", category: "spell" },
    { id: "3", category: ["attack"] },
  ]);
});

test("buildMultiSelectFieldConfig merges discovered values with project config", () => {
  const config = buildMultiSelectFieldConfig(
    ["attack", "spell"],
    {
      multiSelectOptions: {
        attack: { label: "普攻", color: "red" },
        avatar: { label: "化身", color: "purple" },
      },
    },
  );
  assert.deepEqual(config.options, [
    { value: "attack", label: "普攻", color: "red" },
    { value: "avatar", label: "化身", color: "purple" },
    { value: "spell", label: "spell", color: null },
  ]);
  assert.equal(config.optionMap.attack.label, "普攻");
  assert.equal(config.optionMap.spell.color, null);
});

test("buildMultiSelectFieldConfig preserves stored option order and appends discovered values", () => {
  const config = buildMultiSelectFieldConfig(
    ["spell", "attack", "buff"],
    {
      multiSelectOptions: {
        area: { label: "范围", color: "blue" },
        attack: { label: "攻击", color: "red" },
      },
    },
  );
  assert.deepEqual(config.options.map((option) => option.value), ["area", "attack", "spell", "buff"]);
});

test("buildMultiSelectFieldConfigFromRows collects options from every row in the collection", () => {
  const config = buildMultiSelectFieldConfigFromRows(
    [
      { id: "1", tags: ["empower"] },
      { id: "2", tags: ["fire", "support"] },
      { id: "3", tags: [] },
      { id: "4", tags: "ignored" },
    ],
    "tags",
    {
      multiSelectOptions: {
        empower: { label: "Empower", color: "orange" },
      },
    },
  );
  assert.deepEqual(config.options.map((option) => option.value), ["empower", "fire", "support"]);
  assert.equal(config.optionMap.empower.label, "Empower");
});

test("sortValuesByOptionOrder follows configured option order and keeps unknown values at the end", () => {
  assert.deepEqual(
    sortValuesByOptionOrder(["attack", "unknown", "area"], ["area", "attack"]),
    ["area", "attack", "unknown"],
  );
});

test("buildOptionConfigByOrder rebuilds object insertion order from the requested sequence", () => {
  assert.deepEqual(
    Object.keys(buildOptionConfigByOrder(
      {
        attack: { label: "攻击", color: "red" },
        area: { label: "范围", color: "blue" },
        buff: { label: "增益", color: null },
      },
      ["buff", "attack"],
    )),
    ["buff", "attack", "area"],
  );
});

test("buildOptionConfigByOrder materializes missing ordered values with default metadata", () => {
  assert.deepEqual(
    buildOptionConfigByOrder(
      {
        attack: { label: "攻击", color: "red" },
      },
      ["spell", "attack"],
    ),
    {
      spell: { label: "spell", color: null },
      attack: { label: "攻击", color: "red" },
    },
  );
});

test("buildOptionConfigFromOptions preserves the provided order and metadata", () => {
  assert.deepEqual(
    buildOptionConfigFromOptions([
      { value: "spell", label: "法术", color: "blue" },
      { value: "attack", label: "攻击", color: null },
    ]),
    {
      spell: { label: "法术", color: "blue" },
      attack: { label: "攻击", color: null },
    },
  );
});

test("renameOptionConfigValue preserves the original option position", () => {
  const renamed = renameOptionConfigValue(
    {
      attack: { label: "攻击", color: "red" },
      area: { label: "范围", color: "blue" },
      buff: { label: "增益", color: null },
    },
    "area",
    "zone",
  );
  assert.deepEqual(Object.keys(renamed), ["attack", "zone", "buff"]);
  assert.equal(renamed.zone.color, "blue");
});
