import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentModel } from "../src/document-model.mjs";
import { buildDocumentStore } from "../src/model/document-store.mjs";
import {
  addFieldByRowId,
  createWritebackAdapter,
  deleteRowByRowId,
  duplicateRowByRowId,
  reorderRowsByRowId,
  resolveRowLocatorById,
  setAuthorizedCellValueByRowId,
  setCellValueByRowId,
  setNestedValueByRowId,
} from "../src/model/writeback-adapter.mjs";

const fixturePolicy = {
  version: 3,
  targets: [{
    file: "fixtures/items.json",
    collection: "$",
  }],
  textArtifacts: [],
};

test("setCellValueByRowId updates the source row addressed by row id", () => {
  const model = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ], "json", "memory://skills.json");
  const store = buildDocumentStore({ documentId: "skills", model });
  const collection = store.collections.get("$");
  assert.ok(collection);
  const betaRowId = collection.rowViews[1].rowId;

  setCellValueByRowId({
    model,
    store,
    collectionPath: "$",
    rowId: betaRowId,
    fieldName: "name",
    value: "Beta Prime",
  });

  assert.equal(model.root[1].name, "Beta Prime");
});

test("authorized adapter patch accepts skill-selected values inside the configured target", () => {
  const model = buildDocumentModel([{ name: "Alpha" }], "json", "memory://items.json");
  const store = buildDocumentStore({ documentId: "items", model });
  const rowId = store.collections.get("$")?.rowViews[0].rowId;
  setAuthorizedCellValueByRowId({ model, store, policy: fixturePolicy, file: "fixtures/items.json", collectionPath: "$", rowId, fieldName: "name", value: "Beta" });
  assert.equal(model.root[0].name, "Beta");
  setAuthorizedCellValueByRowId({ model, store, policy: fixturePolicy, file: "fixtures/items.json", collectionPath: "$", rowId, fieldName: "name", value: null });
  assert.equal(model.root[0].name, null);
  assert.throws(() => setAuthorizedCellValueByRowId({ model, store, policy: fixturePolicy, file: "fixtures/other.json", collectionPath: "$", rowId, fieldName: "name", value: "Denied" }), (error) => error?.code === "ENTRY_ACTION_POLICY_TARGET_DENIED");
});

test("setNestedValueByRowId updates nested source paths through row id lookup", () => {
  const model = buildDocumentModel([
    { id: "a", effects: [{ value: 10 }] },
  ], "json", "memory://skills.json");
  const store = buildDocumentStore({ documentId: "skills", model });
  const rowId = store.collections.get("$")?.rowViews[0].rowId;
  assert.ok(rowId);

  setNestedValueByRowId({
    model,
    store,
    collectionPath: "$",
    rowId,
    pathParts: ["effects", 0, "value"],
    value: 25,
  });

  assert.equal(model.root[0].effects[0].value, 25);
});

test("deleteRowByRowId removes the correct source row", () => {
  const model = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
    { id: "c", name: "Gamma" },
  ], "json", "memory://skills.json");
  const store = buildDocumentStore({ documentId: "skills", model });
  const rowId = store.collections.get("$")?.rowViews[1].rowId;
  assert.ok(rowId);

  deleteRowByRowId({
    model,
    store,
    collectionPath: "$",
    rowId,
  });

  assert.deepEqual(model.root.map((row) => row.id), ["a", "c"]);
});

test("addFieldByRowId writes to the selected row only", () => {
  const model = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ], "json", "memory://skills.json");
  const store = buildDocumentStore({ documentId: "skills", model });
  const rowId = store.collections.get("$")?.rowViews[1].rowId;
  assert.ok(rowId);

  addFieldByRowId({
    model,
    store,
    collectionPath: "$",
    rowId,
    fieldName: "notes",
    value: "ready",
  });

  assert.equal(model.root[0].notes, undefined);
  assert.equal(model.root[1].notes, "ready");
});

test("resolveRowLocatorById reflects updated source keys after record-map rename", () => {
  const model = buildDocumentModel({
    alpha: { name: "Alpha" },
    beta: { name: "Beta" },
  }, "json", "memory://map.json");
  const first = buildDocumentStore({ documentId: "map", model });
  const rowId = first.collections.get("$")?.rowViews[0].rowId;
  assert.ok(rowId);

  setCellValueByRowId({
    model,
    store: first,
    collectionPath: "$",
    rowId,
    fieldName: "key",
    value: "alpha_prime",
  });

  const second = buildDocumentStore({
    documentId: "map",
    model,
    previousStore: first,
  });
  const locator = resolveRowLocatorById({
    store: second,
    collectionPath: "$",
    rowId,
  });

  assert.deepEqual(locator, {
    rowId,
    collectionPath: "$",
    sourceIndex: 0,
    sourceKey: "alpha_prime",
    sourceOrder: 0,
  });
});

test("stateful writeback adapter preserves explicit documentId across reopen and mutations", () => {
  const model = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ], "json", "memory://skills.json");
  const adapter = createWritebackAdapter({
    documentId: "skills",
    model,
  });
  const rowId = adapter.store.collections.get("$")?.rowViews[1].rowId;
  assert.equal(rowId, "skills:$:1");

  adapter.setCellValueByRowId("$", rowId, "name", "Beta Prime");
  const nextModel = buildDocumentModel(model.root, "json", "memory://skills.json");
  adapter.reopen(nextModel);

  const locator = adapter.getSourceLocatorByRowId("$", rowId);
  assert.deepEqual(locator, {
    rowId,
    collectionPath: "$",
    sourceIndex: 1,
    sourceKey: null,
    sourceOrder: 1,
  });
});

test("reorderRowsByRowId resolves stable ids and preserves the moved object identity", () => {
  const alpha = { __entry_id: "01JZTESTENTRY0000000000000A", id: "a" };
  const beta = { __entry_id: "01JZTESTENTRY0000000000000B", id: "b" };
  const gamma = { __entry_id: "01JZTESTENTRY0000000000000C", id: "c" };
  const model = buildDocumentModel([alpha, beta, gamma], "json");
  const adapter = createWritebackAdapter({ documentId: "skills", model });

  const result = adapter.reorderRowsByRowId(
    "$",
    "01JZTESTENTRY0000000000000A",
    "01JZTESTENTRY0000000000000C",
    "after",
  );

  assert.deepEqual(model.root.map((row) => row.id), ["b", "c", "a"]);
  assert.equal(model.root[2], alpha);
  assert.deepEqual(result, {
    rowId: "01JZTESTENTRY0000000000000A",
    sourceIndex: 2,
    sourceKey: null,
  });
  assert.equal(adapter.getSourceLocatorByRowId("$", result.rowId).sourceIndex, 2);
});

test("stateless reorderRowsByRowId rejects record-map ordering without mutation", () => {
  const model = buildDocumentModel({
    alpha: { name: "Alpha" },
    beta: { name: "Beta" },
  }, "json");
  const store = buildDocumentStore({ documentId: "map", model });
  const [alphaId, betaId] = store.collections.get("$").rowIds;
  assert.throws(() => reorderRowsByRowId({
    model,
    store,
    collectionPath: "$",
    sourceRowId: alphaId,
    targetRowId: betaId,
    placement: "after",
  }), /do not support row ordering/);
  assert.deepEqual(Object.keys(model.root), ["alpha", "beta"]);
});

test("reorderRowsByRowId rejects missing and identical row identities without mutation", () => {
  const model = buildDocumentModel([
    { id: "a" },
    { id: "b" },
  ], "json");
  const store = buildDocumentStore({ documentId: "skills", model });
  const [alphaId] = store.collections.get("$").rowIds;

  assert.throws(() => reorderRowsByRowId({
    model,
    store,
    collectionPath: "$",
    sourceRowId: alphaId,
    targetRowId: alphaId,
    placement: "after",
  }), /must be different/);
  assert.throws(() => reorderRowsByRowId({
    model,
    store,
    collectionPath: "$",
    sourceRowId: alphaId,
    targetRowId: "missing-row",
    placement: "after",
  }), /Unknown rowId/);
  assert.deepEqual(model.root.map((row) => row.id), ["a", "b"]);
});

test("stateful adapter reorders root primitive and mixed arrays without losing source row identity", () => {
  const objectRow = { name: "object" };
  const model = buildDocumentModel(["alpha", 7, objectRow, "omega"], "json");
  const adapter = createWritebackAdapter({ documentId: "mixed", model });
  const sourceRowId = adapter.store.collections.get("$").rowIds[0];
  const targetRowId = adapter.store.collections.get("$").rowIds[3];

  const moved = adapter.reorderRowsByRowId("$", sourceRowId, targetRowId, "after");

  assert.deepEqual(model.root, [7, objectRow, "omega", "alpha"]);
  assert.deepEqual(moved, {
    rowId: sourceRowId,
    sourceIndex: 3,
    sourceKey: null,
  });
  assert.equal(adapter.getSourceLocatorByRowId("$", sourceRowId).sourceIndex, 3);
  assert.equal(adapter.getSourceLocatorByRowId("$", targetRowId).sourceIndex, 2);
});

test("stateful primitive reorder validates failures before mutating the source array", () => {
  const model = buildDocumentModel(["alpha", "beta"], "json");
  const adapter = createWritebackAdapter({ documentId: "values", model });
  const [sourceRowId, targetRowId] = adapter.store.collections.get("$").rowIds;

  assert.throws(
    () => adapter.reorderRowsByRowId("$", sourceRowId, targetRowId, "middle"),
    /Invalid row placement/,
  );
  assert.deepEqual(model.root, ["alpha", "beta"]);
  assert.equal(adapter.getSourceLocatorByRowId("$", sourceRowId).sourceIndex, 0);
});

test("stateful adapter moves the selected identity between equal primitive values", () => {
  const model = buildDocumentModel(["r", "r", "x"], "json");
  const adapter = createWritebackAdapter({ documentId: "repeated-values", model });
  const [firstRowId, secondRowId, targetRowId] = adapter.store.collections.get("$").rowIds;

  const moved = adapter.reorderRowsByRowId("$", firstRowId, secondRowId, "after");

  assert.deepEqual(model.root, ["r", "r", "x"]);
  assert.deepEqual(adapter.store.collections.get("$").rowIds, [
    secondRowId,
    firstRowId,
    targetRowId,
  ]);
  assert.deepEqual(moved, {
    rowId: firstRowId,
    sourceIndex: 1,
    sourceKey: null,
  });
  assert.equal(adapter.getSourceLocatorByRowId("$", firstRowId).sourceIndex, 1);
});

test("duplicateRowByRowId returns the new array identity and rebuilt locator", () => {
  const model = buildDocumentModel([
    { __entry_id: "01JZTESTENTRY0000000000000A", skill_id: "fireball" },
    { __entry_id: "01JZTESTENTRY0000000000000B", skill_id: "fireball_1" },
  ], "json");
  const adapter = createWritebackAdapter({ documentId: "skills", model });

  const duplicate = adapter.duplicateRowByRowId(
    "$",
    "01JZTESTENTRY0000000000000A",
    "skill_id",
  );

  assert.equal(model.root[1].skill_id, "fireball_2");
  assert.equal(duplicate.rowId, model.root[1].__entry_id);
  assert.notEqual(duplicate.rowId, "01JZTESTENTRY0000000000000A");
  assert.deepEqual(duplicate, {
    rowId: model.root[1].__entry_id,
    sourceIndex: 1,
    sourceKey: null,
  });
  assert.deepEqual(adapter.getSourceLocatorByRowId("$", duplicate.rowId), {
    rowId: duplicate.rowId,
    collectionPath: "$",
    sourceIndex: 1,
    sourceKey: null,
    sourceOrder: 2,
  });
});

test("duplicateRowByRowId returns a fresh record-map key and no persistent id", () => {
  const model = buildDocumentModel({
    alpha: { name: "Alpha" },
    beta: { name: "Beta" },
  }, "json");
  const store = buildDocumentStore({ documentId: "map", model });
  const rowId = store.collections.get("$").rowIds[0];
  const result = duplicateRowByRowId({
    model,
    store,
    collectionPath: "$",
    rowId,
  });

  assert.deepEqual(result, {
    rowId: "map:$:2",
    sourceIndex: 2,
    sourceKey: "item_3",
  });
  assert.deepEqual(model.root.item_3, { name: "Alpha" });
  assert.equal("__entry_id" in model.root.item_3, false);
});
