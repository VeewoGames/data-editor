import test from "node:test";
import assert from "node:assert/strict";
import { addRow, buildDocumentModel, deleteRow, setCellValue } from "../src/document-model.mjs";
import { buildDocumentStore } from "../src/model/document-store.mjs";

test("document store exposes row views for array roots", () => {
  const model = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ], "json", "memory://skills.json");

  const store = buildDocumentStore({
    documentId: "skills",
    model,
  });

  const collection = store.collections.get("$");
  assert.ok(collection);
  assert.equal(collection.rowViews.length, 2);
  assert.equal(new Set(collection.rowViews.map((item) => item.rowId)).size, 2);
  assert.notEqual(collection.rowViews[0].row, model.root[0]);
  assert.deepEqual(collection.rowViews.map((item) => ({
    sourceIndex: item.sourceIndex,
    sourceKey: item.sourceKey,
    name: item.row.name,
  })), [
    { sourceIndex: 0, sourceKey: null, name: "Alpha" },
    { sourceIndex: 1, sourceKey: null, name: "Beta" },
  ]);
});

test("document store reuses row ids across rebuilds when surviving row objects are unchanged", () => {
  const rows = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ];
  const model = buildDocumentModel(rows, "json", "memory://skills.json");
  const first = buildDocumentStore({ documentId: "skills", model });

  setCellValue(model, "$", 1, "name", "Beta Prime");

  const second = buildDocumentStore({
    documentId: "skills",
    model,
    previousStore: first,
  });

  const firstCollection = first.collections.get("$");
  const secondCollection = second.collections.get("$");
  assert.ok(firstCollection);
  assert.ok(secondCollection);
  assert.deepEqual(secondCollection.rowViews.map((item) => item.rowId), firstCollection.rowViews.map((item) => item.rowId));
  assert.equal(secondCollection.rowViews[1].row.name, "Beta Prime");
});

test("record-map rebuild preserves row id after key rename and updates source key", () => {
  const model = buildDocumentModel({
    alpha: { name: "Alpha" },
    beta: { name: "Beta" },
  }, "json", "memory://map.json");
  const first = buildDocumentStore({ documentId: "map", model });
  const firstCollection = first.collections.get("$");
  assert.ok(firstCollection);
  const alphaRowId = firstCollection.rowViews[0].rowId;

  setCellValue(model, "$", 0, "key", "alpha_prime");

  const second = buildDocumentStore({
    documentId: "map",
    model,
    previousStore: first,
  });
  const secondCollection = second.collections.get("$");
  assert.ok(secondCollection);

  assert.equal(secondCollection.rowViews[0].rowId, alphaRowId);
  assert.equal(secondCollection.rowViews[0].sourceKey, "alpha_prime");
  assert.equal(secondCollection.handleById.get(alphaRowId)?.sourceKey, "alpha_prime");
  assert.notEqual(secondCollection.rowViews[0].row, model.root.alpha_prime);
});

test("array rebuild after delete and add preserves surviving ids and allocates a fresh row id", () => {
  const model = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ], "json", "memory://skills.json");
  const first = buildDocumentStore({ documentId: "skills", model });
  const firstCollection = first.collections.get("$");
  assert.ok(firstCollection);
  const betaRowId = firstCollection.rowViews[1].rowId;

  deleteRow(model, "$", 0);
  addRow(model, "$", { id: "c", name: "Gamma" });

  const second = buildDocumentStore({
    documentId: "skills",
    model,
    previousStore: first,
  });
  const secondCollection = second.collections.get("$");
  assert.ok(secondCollection);

  assert.equal(secondCollection.rowViews[0].rowId, betaRowId);
  assert.notEqual(secondCollection.rowViews[1].rowId, betaRowId);
  assert.equal(secondCollection.handleById.get(secondCollection.rowViews[1].rowId)?.sourceOrder, 2);
  assert.equal(new Set(secondCollection.rowIds).size, secondCollection.rowIds.length);
});

test("record-map rebuild after delete and add preserves surviving ids and allocates a fresh row id", () => {
  const model = buildDocumentModel({
    alpha: { name: "Alpha" },
    beta: { name: "Beta" },
  }, "json", "memory://map.json");
  const first = buildDocumentStore({ documentId: "map", model });
  const firstCollection = first.collections.get("$");
  assert.ok(firstCollection);
  const betaRowId = firstCollection.rowViews[1].rowId;

  delete model.root.alpha;
  model.root.gamma = { name: "Gamma" };

  const second = buildDocumentStore({
    documentId: "map",
    model,
    previousStore: first,
  });
  const secondCollection = second.collections.get("$");
  assert.ok(secondCollection);

  assert.equal(secondCollection.rowViews[0].rowId, betaRowId);
  assert.notEqual(secondCollection.rowViews[1].rowId, betaRowId);
  assert.equal(secondCollection.handleById.get(secondCollection.rowViews[1].rowId)?.sourceOrder, 2);
  assert.equal(new Set(secondCollection.rowIds).size, secondCollection.rowIds.length);
});
