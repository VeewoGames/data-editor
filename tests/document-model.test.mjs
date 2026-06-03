import test from "node:test";
import assert from "node:assert/strict";
import {
  addField,
  addRow,
  buildDocumentModel,
  deleteField,
  deleteRow,
  getMainColumns,
  getNestedFields,
  getRows,
  setCellValue,
  setNestedValue,
} from "../src/document-model.mjs";

test("root array exposes dollar collection", () => {
  const model = buildDocumentModel([{ id: 1, name: "A" }], "json");
  assert.deepEqual(model.collections.map((c) => c.path), ["$"]);
  assert.equal(getRows(model, "$").length, 1);
});

test("root object exposes array children as collections", () => {
  const model = buildDocumentModel({ skills: [{ id: 1 }], meta: { version: 1 } }, "json");
  assert.deepEqual(model.collections.map((c) => c.path), ["skills"]);
  assert.equal(model.metadata[0].key, "meta");
});

test("root object map exposes a synthetic root collection", () => {
  const model = buildDocumentModel({
    alpha: { name: "A", tags: ["fire"] },
    beta: { name: "B", tags: ["ice"] },
  }, "json");
  assert.deepEqual(model.collections.map((c) => c.path), ["$"]);
  assert.equal(model.rootCollectionKind, "record-map");
  assert.equal(model.rootKeyField, "key");
  assert.deepEqual(getRows(model, "$"), [
    { key: "alpha", name: "A", tags: ["fire"] },
    { key: "beta", name: "B", tags: ["ice"] },
  ]);
  assert.deepEqual(model.metadata, []);
});

test("main columns include primitives and primitive arrays only", () => {
  const model = buildDocumentModel([{ id: 1, tags: ["fire"], effects: [{ type: "damage" }], drops: { gold: 1 } }], "json");
  assert.deepEqual(getMainColumns(model, "$").sort(), ["id", "tags"]);
  assert.deepEqual(getNestedFields(model, "$").sort(), ["drops", "effects"]);
});

test("mixed primitive and object values classify field as nested", () => {
  const model = buildDocumentModel([
    { effect_id: "stun", control: { debuff_family: "control", control_kind: "hard_control" } },
    { effect_id: "focus" },
  ], "json");
  assert.deepEqual(getMainColumns(model, "$").sort(), ["effect_id"]);
  assert.deepEqual(getNestedFields(model, "$").sort(), ["control"]);
});

test("null before object still classifies field as nested", () => {
  const model = buildDocumentModel([
    { effect_id: "ignite", buildup: null, dot: null },
    { effect_id: "burn", buildup: { target: "ignite", threshold: 3 }, dot: { damage_ratio: 0.4, damage_type: "fire" } },
  ], "json");
  assert.deepEqual(getMainColumns(model, "$").sort(), ["effect_id"]);
  assert.deepEqual(getNestedFields(model, "$").sort(), ["buildup", "dot"]);
});

test("cell edit mutates original root shape", () => {
  const model = buildDocumentModel({ skills: [{ id: 1, skill_id: "old" }] }, "json");
  setCellValue(model, "skills", 0, "skill_id", "new");
  assert.equal(model.root.skills[0].skill_id, "new");
});

test("nested edit mutates nested path", () => {
  const model = buildDocumentModel([{ effects: [{ value: 10 }] }], "json");
  setNestedValue(model, "$", 0, ["effects", 0, "value"], 20);
  assert.equal(model.root[0].effects[0].value, 20);
});

test("add row appends empty record to collection", () => {
  const model = buildDocumentModel({ skills: [{ id: 1, skill_id: "a" }] }, "json");
  addRow(model, "skills", { id: null, skill_id: "" });
  assert.equal(model.root.skills.length, 2);
  assert.deepEqual(model.root.skills[1], { id: null, skill_id: "" });
});

test("delete row removes only selected collection row", () => {
  const model = buildDocumentModel([{ id: 1 }, { id: 2 }], "json");
  deleteRow(model, "$", 0);
  assert.deepEqual(model.root, [{ id: 2 }]);
});

test("add field writes empty value to selected row only by default", () => {
  const model = buildDocumentModel([{ id: 1 }, { id: 2 }], "json");
  addField(model, "$", 0, "notes", "");
  assert.equal(model.root[0].notes, "");
  assert.equal("notes" in model.root[1], false);
});

test("delete field removes key from every record in collection", () => {
  const model = buildDocumentModel([{ id: 1, tmp: "x" }, { id: 2, tmp: "y" }], "json");
  const count = deleteField(model, "$", "tmp");
  assert.equal(count, 2);
  assert.deepEqual(model.root, [{ id: 1 }, { id: 2 }]);
});

test("object map edits preserve root object shape", () => {
  const model = buildDocumentModel({
    alpha: { name: "A", category: "open" },
    beta: { name: "B", category: "corridor" },
  }, "json");
  setCellValue(model, "$", 0, "category", "boss");
  setCellValue(model, "$", 0, "key", "alpha_prime");
  addRow(model, "$", { key: "ignored", name: "C", category: "arena" });
  deleteRow(model, "$", 1);
  assert.deepEqual(model.root, {
    alpha_prime: { name: "A", category: "boss" },
    item_3: { name: "C", category: "arena" },
  });
});
