import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentModel } from "../src/document-model.mjs";
import { buildDocumentStore } from "../src/model/document-store.mjs";
import { resolveRelationTargetSelection } from "../src/model/relation-target-lookup.mjs";

test("resolveRelationTargetSelection reuses the active model for same-file targets", async () => {
  const activeModel = buildDocumentModel([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ], "json", "data/items.json");
  buildDocumentStore({ documentId: "items", model: activeModel });
  let loadCount = 0;

  const result = await resolveRelationTargetSelection({
    relationConfig: {
      targetFile: "data/items.json",
      targetCollection: "$",
      targetKey: "id",
      mode: "single",
      allowMissing: false,
      titleFields: ["name"],
    },
    targetValue: "b",
    activeFilePath: "data/items.json",
    activeModel,
    loadDocument: async () => {
      loadCount += 1;
      throw new Error("should not load current document");
    },
  });

  assert.equal(loadCount, 0);
  assert.deepEqual(result, {
    targetFile: "data/items.json",
    targetCollection: "$",
    rowIndex: 1,
    rowId: "items:$:1",
  });
});

test("resolveRelationTargetSelection loads external targets and returns null for misses", async () => {
  const targetModel = buildDocumentModel([
    { skill_id: "slash", skill_name: "Slash" },
  ], "json", "data/skills.json");
  let loadCount = 0;

  const missing = await resolveRelationTargetSelection({
    relationConfig: {
      targetFile: "data/skills.json",
      targetCollection: "$",
      targetKey: "skill_id",
      mode: "single",
      allowMissing: false,
      titleFields: ["skill_name"],
    },
    targetValue: "fire",
    activeFilePath: "data/items.json",
    activeModel: buildDocumentModel([], "json", "data/items.json"),
    loadDocument: async (path) => {
      loadCount += 1;
      assert.equal(path, "data/skills.json");
      return targetModel;
    },
  });

  assert.equal(loadCount, 1);
  assert.equal(missing, null);
});
