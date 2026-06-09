import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentModel } from "../src/document-model.mjs";
import { buildMaintenanceLookupState } from "../src/model/maintenance-lookup.mjs";

test("buildMaintenanceLookupState reuses the active model for same-file incoming relations", async () => {
  const activeModel = buildDocumentModel([
    { id: "a", target_id: "b", name: "Alpha" },
    { id: "b2", target_id: null, name: "Beta" },
  ], "json", "data/items.json");
  let loadCount = 0;

  const result = await buildMaintenanceLookupState({
    selectedPath: "data/items.json",
    collectionPath: "$",
    selectedRow: activeModel.root[1],
    selectedSourceRowIndex: 1,
    selectedRowLabel: "Beta",
    model: activeModel,
    rows: activeModel.root,
    savedRoot: [
      { id: "a", target_id: "b", name: "Alpha" },
      { id: "b", target_id: null, name: "Beta" },
    ],
    viewConfig: {
      fields: {},
      relations: {
        "data/items.json:$:target_id": {
          targetFile: "data/items.json",
          targetCollection: "$",
          targetKey: "id",
          mode: "single",
          allowMissing: false,
          titleFields: ["name"],
        },
      },
      backlinks: {},
      primaryKeys: {
        "data/items.json:$": "id",
      },
      relationsVersion: 3,
    },
    loadDocument: async () => {
      loadCount += 1;
      throw new Error("should not load current document");
    },
  });

  assert.equal(loadCount, 0);
  assert.equal(result.relationBacklinks.length, 1);
  assert.equal(result.primaryKeySyncPlan?.rewrites.length, 1);
  assert.equal(result.primaryKeySyncPlan?.oldValue, "b");
  assert.equal(result.primaryKeySyncPlan?.newValue, "b2");
});

test("buildMaintenanceLookupState returns empty state when no applicable primary key relation exists", async () => {
  const activeModel = buildDocumentModel([
    { id: "a", name: "Alpha" },
  ], "json", "data/items.json");

  const result = await buildMaintenanceLookupState({
    selectedPath: "data/items.json",
    collectionPath: "$",
    selectedRow: activeModel.root[0],
    selectedSourceRowIndex: 0,
    selectedRowLabel: "Alpha",
    model: activeModel,
    rows: activeModel.root,
    savedRoot: activeModel.root,
    viewConfig: {
      fields: {},
      relations: {},
      backlinks: {},
      primaryKeys: {
        "data/items.json:$": "id",
      },
      relationsVersion: 3,
    },
    loadDocument: async () => activeModel,
  });

  assert.deepEqual(result.relationBacklinks, []);
  assert.deepEqual(result.primaryKeyImpacts, {});
  assert.equal(result.primaryKeySyncPlan, null);
});
