import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentModel } from "../src/document-model.mjs";
import { buildRelationLookupState } from "../src/model/relation-lookup.mjs";

test("buildRelationLookupState reuses the active model for same-file relations", async () => {
  const activeModel = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ], "json", "memory://items.json");
  let loadCount = 0;

  const result = await buildRelationLookupState({
    relations: {
      "memory://items.json:$:target_id": {
        targetFile: "memory://items.json",
        targetCollection: "$",
        targetKey: "id",
        mode: "single",
        allowMissing: false,
        titleFields: ["name"],
      },
    },
    activeFilePath: "memory://items.json",
    activeModel,
    loadDocument: async () => {
      loadCount += 1;
      throw new Error("should not load current document");
    },
  });

  assert.equal(loadCount, 0);
  assert.deepEqual([...result.relationIndexes["memory://items.json:$:target_id"]], ["a", "b"]);
  assert.equal(result.relationOptions["memory://items.json:$:target_id"][0]?.label, "Alpha");
});

test("buildRelationLookupState returns null/empty when target documents are missing", async () => {
  const result = await buildRelationLookupState({
    relations: {
      "memory://items.json:$:target_id": {
        targetFile: "memory://missing.json",
        targetCollection: "$",
        targetKey: "id",
        mode: "single",
        allowMissing: false,
        titleFields: ["name"],
      },
    },
    loadDocument: async () => {
      throw new Error("missing");
    },
  });

  assert.equal(result.relationIndexes["memory://items.json:$:target_id"], null);
  assert.deepEqual(result.relationOptions["memory://items.json:$:target_id"], []);
});
