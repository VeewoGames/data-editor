import assert from "node:assert/strict";
import test from "node:test";
import normalizeFetchedViewConfig from "../src/view-config-client.mjs";

test("normalizeFetchedViewConfig fills document config buckets for legacy server payloads", () => {
  const normalized = normalizeFetchedViewConfig({
    fields: {
      "data/runes.json:$:rarity": {
        type: "Select",
        selectOptions: {},
        multiSelectOptions: {},
      },
    },
    titleFields: {},
    primaryKeys: {
      "data/runes.json:$": "rune_id",
    },
    backlinks: {},
    relations: {},
    relationsVersion: 3,
  });

  assert.deepEqual(normalized.documentFiles, {});
  assert.deepEqual(normalized.documentFields, {});
  assert.equal(normalized.primaryKeys["data/runes.json:$"], "rune_id");
});
