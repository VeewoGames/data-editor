import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentModel } from "../src/document-model.mjs";
import { buildBacklinkLookupState } from "../src/model/backlink-lookup.mjs";

test("buildBacklinkLookupState reuses the active model for same-file backlink sources", async () => {
  const activeModel = buildDocumentModel([
    { id: "a", link: "b" },
    { id: "b", link: null },
  ], "json", "data/items.json");
  let loadCount = 0;

  const result = await buildBacklinkLookupState({
    targetFile: "data/items.json",
    targetCollection: "$",
    rows: activeModel.root,
    viewConfig: {
      fields: {},
      relations: {
        "data/items.json:$:link": {
          targetFile: "data/items.json",
          targetCollection: "$",
          targetKey: "id",
          mode: "single",
          allowMissing: false,
          titleFields: ["id"],
        },
      },
      backlinks: {},
      primaryKeys: {
        "data/items.json:$": "id",
      },
      relationsVersion: 3,
    },
    activeModel,
    loadDocument: async () => {
      loadCount += 1;
      throw new Error("should not load current document");
    },
  });

  assert.equal(loadCount, 0);
  assert.equal(result.backlinkColumns.length, 1);
  assert.equal(result.backlinkColumns[0]?.fieldName, "back_link");
  const targetRowId = Object.keys(result.backlinkValuesByRowId).find((rowId) => result.backlinkValuesByRowId[rowId].back_link?.length);
  assert.ok(targetRowId);
});

test("buildBacklinkLookupState returns empty backlinks when source documents are missing", async () => {
  const activeModel = buildDocumentModel([
    { id: "a" },
  ], "json", "data/items.json");

  const result = await buildBacklinkLookupState({
    targetFile: "data/items.json",
    targetCollection: "$",
    rows: activeModel.root,
    viewConfig: {
      fields: {},
      relations: {
        "data/missing.json:$:target_id": {
          targetFile: "data/items.json",
          targetCollection: "$",
          targetKey: "id",
          mode: "single",
          allowMissing: false,
          titleFields: ["id"],
        },
      },
      backlinks: {},
      primaryKeys: {
        "data/items.json:$": "id",
      },
      relationsVersion: 3,
    },
    activeModel,
    loadDocument: async () => {
      throw new Error("missing");
    },
  });

  assert.equal(result.backlinkColumns.length, 1);
  const rowIds = Object.keys(result.backlinkValuesByRowId);
  assert.equal(rowIds.length, 1);
  assert.deepEqual(result.backlinkValuesByRowId[rowIds[0]].back_target_id, []);
});
