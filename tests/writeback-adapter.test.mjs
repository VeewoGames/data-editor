import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentModel } from "../src/document-model.mjs";
import { buildDocumentStore } from "../src/model/document-store.mjs";
import {
  addFieldByRowId,
  createWritebackAdapter,
  deleteRowByRowId,
  resolveRowLocatorById,
  setCellValueByRowId,
  setNestedValueByRowId,
} from "../src/model/writeback-adapter.mjs";

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
