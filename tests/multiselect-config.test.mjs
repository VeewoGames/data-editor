import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMultiSelectFieldConfig,
  removeMultiSelectOptionFromRows,
  removeSingleSelectOptionFromRows,
  renameMultiSelectOptionInRows,
  renameSingleSelectOptionInRows,
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
    { id: "1", category: "" },
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
