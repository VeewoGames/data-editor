import assert from "node:assert/strict";
import test from "node:test";
import normalizeFetchedViewConfig from "../src/view-config-client.mjs";

test("normalizeFetchedViewConfig preserves field display labels", () => {
  const normalized = normalizeFetchedViewConfig({
    fields: {
      "data/weapons.json:$:magazine_size": {
        type: "Select",
        label: "弹夹容量",
        selectOptions: {},
        multiSelectOptions: {},
      },
      "data/weapons.json:$:reload_time_s": {
        type: "Text",
        selectOptions: {},
        multiSelectOptions: {},
      },
    },
    titleFields: {},
    primaryKeys: {},
    backlinks: {},
    relations: {},
    relationsVersion: 3,
  });

  assert.equal(normalized.fields["data/weapons.json:$:magazine_size"].label, "弹夹容量");
  assert.equal(normalized.fields["data/weapons.json:$:reload_time_s"].label, undefined);
});

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

test("normalizeFetchedViewConfig drops relation configs that conflict with enabled document fields", () => {
  const normalized = normalizeFetchedViewConfig({
    fields: {
      "data/keywords.json:$:keyword_doc": {
        type: "Document",
        selectOptions: {},
        multiSelectOptions: {},
      },
    },
    documentFields: {
      "data/keywords.json:$:keyword_doc": {
        enabled: true,
      },
    },
    relations: {
      "data/keywords.json:$:keyword_doc": {
        targetFile: "data/docs.json",
        targetCollection: "$",
        targetKey: "id",
        mode: "single",
        titleFields: ["title"],
        allowMissing: false,
      },
    },
  });

  assert.deepEqual(normalized.documentFields, {
    "data/keywords.json:$:keyword_doc": {
      enabled: true,
    },
  });
  assert.deepEqual(normalized.relations, {});
});

test("normalizeFetchedViewConfig preserves legacy non-text title and primary key assignments", () => {
  const normalized = normalizeFetchedViewConfig({
    fields: {
      "data/e2e_select.json:$:category": {
        type: "Select",
        selectOptions: {},
        multiSelectOptions: {},
      },
      "data/e2e_primary_key_candidates.json:alpha:code": {
        type: "Document",
        selectOptions: {},
        multiSelectOptions: {},
      },
    },
    titleFields: {
      "data/e2e_select.json:$": "category",
    },
    primaryKeys: {
      "data/e2e_primary_key_candidates.json:alpha": "code",
    },
    backlinks: {},
    relations: {},
    relationsVersion: 3,
  });

  assert.deepEqual(normalized.titleFields, {
    "data/e2e_select.json:$": "category",
  });
  assert.equal(normalized.primaryKeys["data/e2e_primary_key_candidates.json:alpha"], "code");
});
