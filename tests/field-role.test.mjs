import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBacklinkFieldName,
  deriveBacklinkConfigs,
  getPrimaryKeyField,
  resolveFieldRole,
  syncBacklinksWithRelations,
} from "../src/model/field-role.mjs";

test("getPrimaryKeyField returns configured primary key", () => {
  const field = getPrimaryKeyField({
    primaryKeys: {
      "data/keywords.json:$": "keyword_id",
    },
  }, "data/keywords.json", "$");

  assert.equal(field, "keyword_id");
});

test("buildBacklinkFieldName prefixes relation field name", () => {
  assert.equal(buildBacklinkFieldName("keyword_id"), "back_keyword_id");
  assert.equal(buildBacklinkFieldName("status_effect_ids"), "back_status_effect_ids");
});

test("deriveBacklinkConfigs builds runtime backlink definitions from relations", () => {
  const backlinks = deriveBacklinkConfigs({
    primaryKeys: {
      "data/keywords.json:$": "keyword_id",
    },
    backlinks: {},
    relations: {
      "data/status_effects.json:$:keyword_id": {
        targetFile: "data/keywords.json",
        targetCollection: "$",
        targetKey: "keyword_id",
        mode: "single",
        titleFields: ["name"],
        allowMissing: false,
      },
    },
  });

  assert.deepEqual(backlinks, {
    "data/keywords.json:$:back_keyword_id": {
      sourceRelation: "data/status_effects.json:$:keyword_id",
      displayMode: "list",
    },
  });
});

test("syncBacklinksWithRelations removes stale entries and keeps valid explicit keys", () => {
  const backlinks = syncBacklinksWithRelations({
    "data/status_effects.json:$:keyword_id": {
      targetFile: "data/keywords.json",
      targetCollection: "$",
      targetKey: "keyword_id",
      mode: "single",
      titleFields: ["name"],
      allowMissing: false,
    },
  }, {
    "data/keywords.json:$:back_keyword_id": {
      sourceRelation: "data/status_effects.json:$:keyword_id",
      displayMode: "list",
    },
    "data/keywords.json:$:back_stale": {
      sourceRelation: "data/missing.json:$:keyword_id",
      displayMode: "list",
    },
  });

  assert.deepEqual(backlinks, {
    "data/keywords.json:$:back_keyword_id": {
      sourceRelation: "data/status_effects.json:$:keyword_id",
      displayMode: "list",
    },
  });
});

test("resolveFieldRole prefers primary key over relation", () => {
  const result = resolveFieldRole({
    sourceFile: "data/keywords.json",
    sourceCollection: "$",
    fieldName: "keyword_id",
    viewConfig: {
      fields: {},
      primaryKeys: {
        "data/keywords.json:$": "keyword_id",
      },
      backlinks: {},
      relations: {
        "data/keywords.json:$:keyword_id": {
          targetFile: "data/keywords.json",
          targetCollection: "$",
          targetKey: "keyword_id",
          mode: "single",
          titleFields: ["name"],
          allowMissing: false,
        },
      },
      relationsVersion: 3,
    },
  });

  assert.deepEqual(result, {
    kind: "primaryKey",
    primaryKey: "keyword_id",
  });
});

test("resolveFieldRole returns backlink for derived backlink column", () => {
  const result = resolveFieldRole({
    sourceFile: "data/keywords.json",
    sourceCollection: "$",
    fieldName: "back_keyword_id",
    viewConfig: {
      fields: {},
      primaryKeys: {
        "data/keywords.json:$": "keyword_id",
      },
      backlinks: {},
      relations: {
        "data/status_effects.json:$:keyword_id": {
          targetFile: "data/keywords.json",
          targetCollection: "$",
          targetKey: "keyword_id",
          mode: "single",
          titleFields: ["name"],
          allowMissing: false,
        },
      },
      relationsVersion: 3,
    },
  });

  assert.deepEqual(result, {
    kind: "backlink",
    backlinkKey: "data/keywords.json:$:back_keyword_id",
    config: {
      sourceRelation: "data/status_effects.json:$:keyword_id",
      displayMode: "list",
    },
  });
});

test("resolveFieldRole returns document for configured document field", () => {
  const result = resolveFieldRole({
    sourceFile: "data/keywords.json",
    sourceCollection: "$",
    fieldName: "keyword_doc",
    viewConfig: {
      fields: {},
      documentFields: {
        "data/keywords.json:$:keyword_doc": {
          enabled: true,
        },
      },
      primaryKeys: {
        "data/keywords.json:$": "keyword_id",
      },
      backlinks: {},
      relations: {},
      relationsVersion: 3,
    },
  });

  assert.deepEqual(result, {
    kind: "document",
    documentFieldKey: "data/keywords.json:$:keyword_doc",
    config: {
      enabled: true,
    },
  });
});
