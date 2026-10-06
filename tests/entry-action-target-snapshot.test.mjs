import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentModel, setCellValue } from "../src/document-model.mjs";
import { buildDocumentStore } from "../src/model/document-store.mjs";
import { resolveEntryActionTargetSnapshot } from "../src/entry-action-target-snapshot.mjs";
import { rowDigest } from "../src/row-digest.mjs";

test("a draft flushed after clicking uses the saved source row rather than the old detail copy", () => {
  const model = buildDocumentModel({ items: [{ __entry_id: "entry-a", description: "Old" }] }, "json");
  const store = buildDocumentStore({ model });
  const clickedDetailRow = store.collections.get("items").rowById.get("entry-a");
  setCellValue(model, "items", 0, "description", "Edited before automation");
  const savedRow = JSON.parse(JSON.stringify(model.root)).items[0];
  assert.notEqual(rowDigest(clickedDetailRow), rowDigest(savedRow));
  const target = resolveEntryActionTargetSnapshot(model, "items", "entry-a");
  assert.equal(rowDigest(target.row), rowDigest(savedRow));
  setCellValue(model, "items", 0, "description", "Changed during execution");
  assert.notEqual(rowDigest(target.row), rowDigest(model.root.items[0]));
});

test("the same entry is located after reorder and a removed entry never targets its replacement", () => {
  const model = buildDocumentModel({ items: [{ __entry_id: "a" }, { __entry_id: "b" }] }, "json");
  model.root.items.reverse();
  assert.equal(resolveEntryActionTargetSnapshot(model, "items", "a").sourceRowIndex, 1);
  model.root.items.pop();
  assert.throws(() => resolveEntryActionTargetSnapshot(model, "items", "a"), /无法唯一定位/);
  model.root.items.push({ __entry_id: "b" });
  assert.throws(() => resolveEntryActionTargetSnapshot(model, "items", "b"), /无法唯一定位/);
});

test("record maps retain their source identity and virtual key after a draft changes", () => {
  const model = buildDocumentModel({ alpha: { name: "Old" }, beta: { name: "Other" } }, "json");
  const store = buildDocumentStore({ model });
  const rowId = store.collections.get("$").rowIds[0];
  setCellValue(model, "$", 0, "name", "New");
  assert.deepEqual(resolveEntryActionTargetSnapshot(model, "$", rowId), {
    row: { key: "alpha", name: "New" }, sourceRowIndex: 0,
  });
});
