import assert from "node:assert/strict";
import test from "node:test";
import { buildTableRuntimeDeps } from "../src/table/table-runtime-deps.mjs";

test("buildTableRuntimeDeps separates option caches and relation runtime deps by field", () => {
  const result = buildTableRuntimeDeps({
    visibleFields: ["tags", "rarity", "target_id", "plain_text"],
    rows: [
      { tags: ["fire", "aoe"], rarity: "rare", target_id: "b", plain_text: "alpha" },
      { tags: ["aoe"], rarity: "common", target_id: "a", plain_text: "beta" },
    ],
    sourcePath: "data/items.json",
    collectionPath: "$",
    displayTypes: {
      tags: "Multi-select",
      rarity: "Select",
      plain_text: "Text",
    },
    fieldViewConfigs: {
      rarity: {
        selectOptions: {
          rare: { label: "Rare", color: "blue" },
        },
      },
    },
    relationConfigs: {
      "data/items.json:$:target_id": {
        targetFile: "data/items.json",
        targetCollection: "$",
        targetKey: "id",
        mode: "single",
        allowMissing: false,
        titleFields: ["name"],
      },
    },
    relationOptions: {
      "data/items.json:$:target_id": [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
    },
  });

  assert.deepEqual(result.fieldOptions.tags.options.map((option) => option.value), ["fire", "aoe"]);
  assert.deepEqual(result.selectOptions.rarity.options.map((option) => option.value), ["rare", "common"]);
  assert.equal(result.relationConfigByField.target_id?.targetKey, "id");
  assert.deepEqual(result.relationOptionsByField.target_id.map((option) => option.value), ["a", "b"]);
  assert.deepEqual(result.relationOptionsByField.plain_text, []);
  assert.equal(result.relationConfigByField.plain_text, null);
});
