import test from "node:test";
import assert from "node:assert/strict";
import {
  addField,
  addRow,
  buildDocumentModel,
  deleteField,
  deleteRow,
  duplicateRow,
  getMainColumns,
  getNestedFields,
  getRows,
  reorderRows,
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

test("persistent internal entry id is hidden from visible columns", () => {
  const model = buildDocumentModel([{ __entry_id: "01JZTESTENTRY00000000000000", id: 1, name: "A" }], "json");
  assert.deepEqual(getMainColumns(model, "$").sort(), ["id", "name"]);
  assert.deepEqual(getNestedFields(model, "$"), []);
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
  assert.equal(typeof model.root.skills[1].__entry_id, "string");
  assert.match(model.root.skills[1].__entry_id, /^[0-9A-Z]{26}$/);
  assert.equal(model.root.skills[1].id, null);
  assert.equal(model.root.skills[1].skill_id, "");
});

test("delete row removes only selected collection row", () => {
  const model = buildDocumentModel([{ id: 1 }, { id: 2 }], "json");
  deleteRow(model, "$", 0);
  assert.deepEqual(model.root, [{ id: 2 }]);
});

test("reorder rows moves the original array object using before and after placement", () => {
  const alpha = { id: "a" };
  const beta = { id: "b" };
  const gamma = { id: "c" };
  const model = buildDocumentModel({ skills: [alpha, beta, gamma] }, "json");

  assert.deepEqual(reorderRows(model, "skills", 0, 2, "after"), {
    sourceIndex: 2,
    sourceKey: null,
  });
  assert.deepEqual(model.root.skills.map((row) => row.id), ["b", "c", "a"]);
  assert.equal(model.root.skills[2], alpha);

  reorderRows(model, "skills", 2, 0, "before");
  assert.deepEqual(model.root.skills.map((row) => row.id), ["a", "b", "c"]);
  assert.equal(model.root.skills[0], alpha);
});

test("reorder rows rejects record maps, identical rows, invalid indexes, and invalid placement", () => {
  const arrayModel = buildDocumentModel([{ id: "a" }, { id: "b" }], "json");
  assert.throws(() => reorderRows(arrayModel, "$", 0, 0, "before"), /must be different/);
  assert.throws(() => reorderRows(arrayModel, "$", -1, 1, "before"), /Invalid source/);
  assert.throws(() => reorderRows(arrayModel, "$", 0, 4, "before"), /Invalid target/);
  assert.throws(() => reorderRows(arrayModel, "$", 0, 1, "middle"), /Invalid row placement/);
  assert.deepEqual(arrayModel.root.map((row) => row.id), ["a", "b"]);

  const mapModel = buildDocumentModel({ alpha: { name: "A" }, beta: { name: "B" } }, "json");
  assert.throws(() => reorderRows(mapModel, "$", 0, 1, "before"), /do not support row ordering/);
  assert.deepEqual(Object.keys(mapModel.root), ["alpha", "beta"]);
});

test("duplicate array row deep clones content, allocates identity, and suffixes string primary keys", () => {
  const source = {
    __entry_id: "01JZTESTENTRY0000000000000A",
    skill_id: "fireball",
    nested: { values: [1, 2] },
  };
  const model = buildDocumentModel([
    source,
    { __entry_id: "01JZTESTENTRY0000000000000B", skill_id: "fireball_1" },
  ], "json");

  const locator = duplicateRow(model, "$", { sourceIndex: 0, sourceKey: null }, "skill_id");
  const duplicate = model.root[1];
  assert.deepEqual(locator, { sourceIndex: 1, sourceKey: null });
  assert.equal(duplicate.skill_id, "fireball_2");
  assert.match(duplicate.__entry_id, /^[0-9A-Z]{26}$/);
  assert.notEqual(duplicate.__entry_id, source.__entry_id);
  assert.notEqual(duplicate, source);
  assert.notEqual(duplicate.nested, source.nested);
  assert.notEqual(duplicate.nested.values, source.nested.values);
  duplicate.nested.values.push(3);
  assert.deepEqual(source.nested.values, [1, 2]);
});

test("duplicate array row increments numeric primary keys", () => {
  const model = buildDocumentModel([
    { id: 1, name: "Alpha" },
    { id: 2, name: "Beta" },
  ], "json");
  duplicateRow(model, "$", { sourceIndex: 0, sourceKey: null }, "id");
  assert.deepEqual(model.root.map((row) => row.id), [1, 3, 2]);
});

test("duplicate record-map row creates a new map key without persistent entry id", () => {
  const model = buildDocumentModel({
    alpha: { name: "Alpha", nested: { enabled: true } },
    beta: { name: "Beta" },
  }, "json");
  const locator = duplicateRow(
    model,
    "$",
    { sourceIndex: 0, sourceKey: "alpha" },
    null,
  );
  assert.deepEqual(locator, { sourceIndex: 2, sourceKey: "item_3" });
  assert.deepEqual(model.root.item_3, { name: "Alpha", nested: { enabled: true } });
  assert.equal("__entry_id" in model.root.item_3, false);
  assert.notEqual(model.root.item_3.nested, model.root.alpha.nested);
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
