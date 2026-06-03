import test from "node:test";
import assert from "node:assert/strict";
import { buildBacklinkGrid, getBacklinkColumnsForView } from "../src/model/backlink-grid.mjs";

test("getBacklinkColumnsForView returns derived backlink columns for target view", () => {
  const columns = getBacklinkColumnsForView({
    targetFile: "data/keywords.json",
    targetCollection: "$",
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

  assert.deepEqual(columns, [{
    backlinkKey: "data/keywords.json:$:back_keyword_id",
    fieldName: "back_keyword_id",
    sourceRelation: "data/status_effects.json:$:keyword_id",
    targetKey: "keyword_id",
    status: "active",
    message: "引用来源：data/status_effects.json",
  }]);
});

test("buildBacklinkGrid groups backlinks by target row and derived field", () => {
  const result = buildBacklinkGrid({
    targetFile: "data/keywords.json",
    targetCollection: "$",
    rows: [
      { keyword_id: "focus", name: "专注" },
      { keyword_id: "poisoned", name: "中毒" },
    ],
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
    documentsByPath: {
      "data/status_effects.json": {
        root: [
          { effect_id: "focus_buff", name: "聚焦", keyword_id: "focus" },
          { effect_id: "toxic", name: "毒伤", keyword_id: "poisoned" },
          { effect_id: "focus_echo", name: "回响", keyword_id: "focus" },
        ],
        collections: [],
        rootKind: "array",
        format: "json",
        sourcePath: "data/status_effects.json",
        rootCollectionKind: undefined,
        rootKeyField: undefined,
        metadata: [],
        __rows: null,
      },
    },
  });

  assert.deepEqual(result.columns, [{
    backlinkKey: "data/keywords.json:$:back_keyword_id",
    fieldName: "back_keyword_id",
    sourceRelation: "data/status_effects.json:$:keyword_id",
    targetKey: "keyword_id",
    status: "active",
    message: "引用来源：data/status_effects.json",
  }]);
  assert.deepEqual(result.valuesByRowIndex[0].back_keyword_id.map((item) => item.title), ["聚焦", "回响"]);
  assert.deepEqual(result.valuesByRowIndex[1].back_keyword_id.map((item) => item.title), ["毒伤"]);
});

test("buildBacklinkGrid marks backlink column invalid when source document is missing", () => {
  const result = buildBacklinkGrid({
    targetFile: "data/keywords.json",
    targetCollection: "$",
    rows: [
      { keyword_id: "focus", name: "专注" },
    ],
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
    documentsByPath: {},
  });

  assert.deepEqual(result.columns, [{
    backlinkKey: "data/keywords.json:$:back_keyword_id",
    fieldName: "back_keyword_id",
    sourceRelation: "data/status_effects.json:$:keyword_id",
    targetKey: "keyword_id",
    status: "missing-source",
    message: "来源文件缺失：data/status_effects.json",
  }]);
  assert.deepEqual(result.valuesByRowIndex[0].back_keyword_id, []);
});
