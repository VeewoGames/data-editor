import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentModel } from "../src/document-model.mjs";
import { buildDocumentStore } from "../src/model/document-store.mjs";
import { buildStableViewEngineRows } from "../src/view/stable-view-engine-rows.mjs";

test("buildStableViewEngineRows reuses previous shells when collection row views stay stable", () => {
  const model = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ], "json", "data/items.json");
  const store = buildDocumentStore({ documentId: "items", model });
  const collectionStore = store.collections.get("$");
  assert.ok(collectionStore);

  const previous = buildStableViewEngineRows(collectionStore, null);
  const next = buildStableViewEngineRows(collectionStore, previous);

  assert.equal(next[0], previous[0]);
  assert.equal(next[1], previous[1]);
});
