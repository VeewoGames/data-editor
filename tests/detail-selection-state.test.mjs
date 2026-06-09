import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentModel } from "../src/document-model.mjs";
import { buildDocumentStore } from "../src/model/document-store.mjs";
import { buildDetailSelectionState, buildVisibleRowViews, resolveDetailSelectionSync } from "../src/detail/selection-state.mjs";

test("buildDetailSelectionState derives visible row navigation from row ids", () => {
  const model = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
    { id: "c", name: "Gamma" },
  ], "json", "data/items.json");
  const store = buildDocumentStore({ documentId: "items", model });
  const collectionStore = store.collections.get("$");
  assert.ok(collectionStore);

  const state = buildDetailSelectionState({
    collectionStore,
    visibleRowIds: ["items:$:0", "items:$:2"],
    selectedRowId: "items:$:2",
    selectedRowIndex: 2,
  });

  assert.equal(state.selectedRow?.name, "Gamma");
  assert.equal(state.selectedVisibleRowPosition, 1);
  assert.deepEqual(state.previousRowTarget, { sourceRowIndex: 0, rowId: "items:$:0" });
  assert.equal(state.nextRowTarget, null);
});

test("resolveDetailSelectionSync falls back to the first surviving row when selected row id disappears", () => {
  const model = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ], "json", "data/items.json");
  const store = buildDocumentStore({ documentId: "items", model });
  const collectionStore = store.collections.get("$");
  assert.ok(collectionStore);

  const sync = resolveDetailSelectionSync({
    collectionStore,
    selectedRowId: "items:$:9",
    selectedRowIndex: null,
  });

  assert.deepEqual(sync, {
    nextRowId: "items:$:0",
    nextRowIndex: 0,
  });
});

test("resolveDetailSelectionSync backfills row id from row index when only index is known", () => {
  const model = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ], "json", "data/items.json");
  const store = buildDocumentStore({ documentId: "items", model });
  const collectionStore = store.collections.get("$");
  assert.ok(collectionStore);

  const sync = resolveDetailSelectionSync({
    collectionStore,
    selectedRowId: null,
    selectedRowIndex: 1,
  });

  assert.deepEqual(sync, {
    nextRowId: "items:$:1",
    nextRowIndex: 1,
  });
});

test("buildVisibleRowViews reuses previous row view shells when visible row ids and row references stay stable", () => {
  const model = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ], "json", "data/items.json");
  const store = buildDocumentStore({ documentId: "items", model });
  const collectionStore = store.collections.get("$");
  assert.ok(collectionStore);

  const previous = buildVisibleRowViews(collectionStore, ["items:$:0", "items:$:1"]);
  const next = buildVisibleRowViews(collectionStore, ["items:$:0", "items:$:1"], previous);

  assert.equal(next[0], previous[0]);
  assert.equal(next[1], previous[1]);
});
