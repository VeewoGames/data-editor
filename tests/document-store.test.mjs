import test from "node:test";
import assert from "node:assert/strict";
import { addRow, buildDocumentModel, deleteRow, setCellValue } from "../src/document-model.mjs";
import { buildDocumentStore } from "../src/model/document-store.mjs";

test("document store exposes row views for array roots", () => {
  const model = buildDocumentModel([
    { __entry_id: "01JZTESTENTRY0000000000000A", id: "a", name: "Alpha" },
    { __entry_id: "01JZTESTENTRY0000000000000B", id: "b", name: "Beta" },
  ], "json", "memory://skills.json");

  const store = buildDocumentStore({
    documentId: "skills",
    model,
  });

  const collection = store.collections.get("$");
  assert.ok(collection);
  assert.equal(collection.rowViews.length, 2);
  assert.equal(new Set(collection.rowViews.map((item) => item.rowId)).size, 2);
  assert.equal(collection.rowViews[0].rowId, "01JZTESTENTRY0000000000000A");
  assert.equal(collection.rowViews[1].rowId, "01JZTESTENTRY0000000000000B");
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
    { __entry_id: "01JZTESTENTRY0000000000000A", id: "a", name: "Alpha" },
    { __entry_id: "01JZTESTENTRY0000000000000B", id: "b", name: "Beta" },
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
  assert.match(secondCollection.rowViews[1].rowId, /^[0-9A-Z]{26}$/);
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

test("primitive array rebuild reuses row ids by value and old occurrence order", () => {
  const model = buildDocumentModel(["alpha", "repeat", "repeat", 7, null], "json");
  const first = buildDocumentStore({ documentId: "values", model });
  const firstIds = first.collections.get("$").rowIds;

  model.root.splice(0, model.root.length, "repeat", 7, "alpha", null, "repeat");
  const second = buildDocumentStore({
    documentId: "values",
    model,
    previousStore: first,
  });
  const secondCollection = second.collections.get("$");
  const secondIds = secondCollection.rowIds;

  assert.deepEqual(secondIds, [
    firstIds[1],
    firstIds[3],
    firstIds[0],
    firstIds[4],
    firstIds[2],
  ]);
  assert.equal(secondCollection.handleById.get(firstIds[0]).sourceIndex, 2);
  assert.equal(secondCollection.handleById.get(firstIds[1]).sourceIndex, 0);
  assert.equal(secondCollection.handleById.get(firstIds[2]).sourceIndex, 4);
});

test("mixed array rebuild preserves object identities and primitive identities together", () => {
  const objectRow = { name: "object" };
  const nestedArrayRow = ["nested"];
  const model = buildDocumentModel(["alpha", objectRow, 9, nestedArrayRow], "json");
  const first = buildDocumentStore({ documentId: "mixed", model });
  const firstIds = first.collections.get("$").rowIds;

  model.root.splice(0, model.root.length, nestedArrayRow, 9, objectRow, "alpha");
  const second = buildDocumentStore({
    documentId: "mixed",
    model,
    previousStore: first,
  });

  assert.deepEqual(second.collections.get("$").rowIds, [
    firstIds[3],
    firstIds[2],
    firstIds[1],
    firstIds[0],
  ]);
});

test("large primitive rebuild reuses identity queues for repeated values", () => {
  const values = Array.from({ length: 5000 }, (_, index) => `value-${index % 5}`);
  const originalValues = [...values];
  const model = buildDocumentModel(values, "json");
  const first = buildDocumentStore({ documentId: "large-values", model });
  const firstIds = first.collections.get("$").rowIds;

  model.root.reverse();
  const second = buildDocumentStore({
    documentId: "large-values",
    model,
    previousStore: first,
  });
  const secondIds = second.collections.get("$").rowIds;

  for (let valueIndex = 0; valueIndex < 5; valueIndex += 1) {
    const value = `value-${valueIndex}`;
    const expectedIds = originalValues
      .map((entry, index) => entry === value ? firstIds[index] : null)
      .filter(Boolean);
    const actualIds = model.root
      .map((entry, index) => entry === value ? secondIds[index] : null)
      .filter(Boolean);
    assert.deepEqual(actualIds, expectedIds);
  }
});

test("collection identity override requires an exact permutation of previous row ids", () => {
  const model = buildDocumentModel(["alpha", "beta", "gamma"], "json");
  const first = buildDocumentStore({ documentId: "values", model });
  const firstCollection = first.collections.get("$");
  const originalRoot = [...model.root];
  const originalRowIds = [...firstCollection.rowIds];
  const originalHandles = originalRowIds.map((rowId) => ({
    rowId,
    ...firstCollection.handleById.get(rowId),
  }));

  const assertRejectedWithoutMutation = (previousStore, override, pattern) => {
    assert.throws(() => buildDocumentStore({
      documentId: "values",
      model,
      previousStore,
      collectionIdentityOverrides: new Map([["$", override]]),
    }), pattern);
    assert.deepEqual(model.root, originalRoot);
    assert.deepEqual(firstCollection.rowIds, originalRowIds);
    assert.deepEqual(
      originalRowIds.map((rowId) => ({
        rowId,
        ...firstCollection.handleById.get(rowId),
      })),
      originalHandles,
    );
  };

  assertRejectedWithoutMutation(null, originalRowIds, /requires a previous collection/);
  assertRejectedWithoutMutation(
    first,
    [originalRowIds[0], originalRowIds[1], "foreign-row"],
    /Unknown overridden rowId/,
  );
  assertRejectedWithoutMutation(
    first,
    [originalRowIds[0], originalRowIds[0], originalRowIds[2]],
    /Duplicate overridden rowId/,
  );
  assertRejectedWithoutMutation(
    first,
    [originalRowIds[0], null, originalRowIds[2]],
    /Invalid overridden rowId/,
  );
  assertRejectedWithoutMutation(
    first,
    [originalRowIds[0], originalRowIds[1]],
    /preserve the previous collection length/,
  );
  assertRejectedWithoutMutation(
    first,
    [originalRowIds[0], originalRowIds[1], originalRowIds[2], originalRowIds[2]],
    /preserve the previous collection length/,
  );
});
