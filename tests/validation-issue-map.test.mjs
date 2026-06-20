import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentModel, getRows, setCellValue } from "../src/document-model.mjs";
import { buildDocumentStore } from "../src/model/document-store.mjs";
import { applyValidationIssueOverrides, buildIssueKey, buildValidationIssueMap, buildValidationSnapshot, patchValidationSnapshotForField, patchValidationSnapshotForRowField } from "../src/validation/issue-map.mjs";
import { resolveValidationIssue } from "../src/validation/issue-lookup.mjs";

test("buildIssueKey prefers rowId and falls back to rowIndex", () => {
  const collectionStore = {
    rowViews: [
      { rowId: "row_a" },
      {},
    ],
  };

  assert.equal(buildIssueKey(collectionStore, 0, "name"), "row_a:name");
  assert.equal(buildIssueKey(collectionStore, 1, "name"), "1:name");
});

test("buildValidationIssueMap keeps current rowId issue contract for primary key duplicates", () => {
  const rows = [
    { id: "dup", name: "Alpha" },
    { id: "dup", name: "Beta" },
  ];
  const collectionStore = {
    rowViews: [
      { rowId: "row_a" },
      { rowId: "row_b" },
    ],
  };

  const issues = buildValidationIssueMap({
    rows,
    collectionStore,
    fieldConfig: {
      displayTypes: {},
      isCompatible: () => true,
    },
    relationIndexes: {},
    validationConfig: {
      primaryKeys: {
        "data/items.json:$": "id",
      },
      relations: {},
    },
    sourcePath: "data/items.json",
    collectionPath: "$",
  });

  assert.match(issues["row_a:id"]?.message ?? "", /id 存在重复值 dup/);
  assert.match(issues["row_b:id"]?.message ?? "", /id 存在重复值 dup/);
});

test("buildValidationIssueMap reports nested relation issues by top-level field key", () => {
  const rows = [
    { reward: { target_id: "missing_target" } },
  ];
  const relationKey = "data/items.json:$:reward.target_id";
  const issues = buildValidationIssueMap({
    rows,
    collectionStore: {
      rowViews: [{ rowId: "row_reward" }],
    },
    fieldConfig: {
      displayTypes: {},
      isCompatible: () => true,
    },
    relationIndexes: {
      [relationKey]: new Set(["existing"]),
    },
    validationConfig: {
      primaryKeys: {},
      relations: {
        [relationKey]: {
          targetFile: "data/targets.json",
          targetCollection: "$",
          targetKey: "id",
          mode: "single",
          allowMissing: false,
          titleFields: ["name"],
        },
      },
    },
    sourcePath: "data/items.json",
    collectionPath: "$",
  });

  assert.match(issues["row_reward:reward"]?.message ?? "", /未找到引用 missing_target/);
});

test("buildValidationIssueMap falls back to rowIndex keys when rowId context is missing", () => {
  const issues = buildValidationIssueMap({
    rows: [{ id: "dup" }, { id: "dup" }],
    collectionStore: null,
    fieldConfig: {
      displayTypes: {},
      isCompatible: () => true,
    },
    relationIndexes: {},
    validationConfig: {
      primaryKeys: {
        "data/items.json:$": "id",
      },
      relations: {},
    },
    sourcePath: "data/items.json",
    collectionPath: "$",
  });

  assert.match(issues["0:id"]?.message ?? "", /id 存在重复值 dup/);
  assert.match(issues["1:id"]?.message ?? "", /id 存在重复值 dup/);
});

test("buildValidationIssueMap preserves current issue priority for incompatible display types", () => {
  const relationKey = "data/items.json:$:reward";
  const issues = buildValidationIssueMap({
    rows: [{ reward: "missing_target" }],
    collectionStore: {
      rowViews: [{ rowId: "row_reward" }],
    },
    fieldConfig: {
      displayTypes: { reward: "relation" },
      isCompatible: () => false,
    },
    relationIndexes: {
      [relationKey]: new Set(["existing"]),
    },
    validationConfig: {
      primaryKeys: {},
      relations: {
        [relationKey]: {
          targetFile: "data/targets.json",
          targetCollection: "$",
          targetKey: "id",
          mode: "single",
          allowMissing: false,
          titleFields: ["name"],
        },
      },
    },
    sourcePath: "data/items.json",
    collectionPath: "$",
  });

  assert.deepEqual(issues["row_reward:reward"], {
    severity: "error",
    message: "当前值不能用 relation 显示",
  });
});

test("resolveValidationIssue lets UI consumers fall back from rowId to rowIndex keys", () => {
  const validation = buildValidationSnapshot({
    rows: [{ name: "Alpha" }],
    collectionStore: null,
    fieldConfig: {
      displayTypes: {},
      isCompatible: () => true,
    },
    relationIndexes: {},
    validationConfig: {
      primaryKeys: {},
      relations: {},
    },
    sourcePath: "data/items.json",
    collectionPath: "$",
  });
  validation.byRowIndex["7"] = {
    name: { severity: "warning", message: "fallback issue" },
  };

  assert.deepEqual(resolveValidationIssue(validation, "missing_row", 7, "name"), {
    severity: "warning",
    message: "fallback issue",
  });
  assert.equal(resolveValidationIssue(validation, null, null, "name"), null);
});

test("buildValidationSnapshot groups issue lookup into byRowId and byRowIndex buckets", () => {
  const validation = buildValidationSnapshot({
    rows: [{ id: "dup" }, { id: "dup" }],
    collectionStore: {
      rowViews: [{ rowId: "row_a" }, {}],
    },
    fieldConfig: {
      displayTypes: {},
      isCompatible: () => true,
    },
    relationIndexes: {},
    validationConfig: {
      primaryKeys: {
        "data/items.json:$": "id",
      },
      relations: {},
    },
    sourcePath: "data/items.json",
    collectionPath: "$",
  });

  assert.match(validation.byRowId.row_a.id?.message ?? "", /id 存在重复值 dup/);
  assert.match(validation.byRowIndex["1"].id?.message ?? "", /id 存在重复值 dup/);
});

test("buildValidationIssueMap keeps row order aligned with collectionStore after record-map rebuild", () => {
  const model = buildDocumentModel({
    alpha: { id: "dup", name: "Alpha" },
    beta: { id: "dup", name: "Beta" },
  }, "json", "memory://map.json");
  const firstStore = buildDocumentStore({ documentId: "map", model });

  setCellValue(model, "$", 0, "key", "alpha_prime");

  const secondStore = buildDocumentStore({
    documentId: "map",
    model,
    previousStore: firstStore,
  });
  const collectionStore = secondStore.collections.get("$");
  assert.ok(collectionStore);

  const issues = buildValidationIssueMap({
    rows: getRows(model, "$"),
    collectionStore,
    fieldConfig: {
      displayTypes: {},
      isCompatible: () => true,
    },
    relationIndexes: {},
    validationConfig: {
      primaryKeys: {
        "memory://map.json:$": "id",
      },
      relations: {},
    },
    sourcePath: "memory://map.json",
    collectionPath: "$",
  });

  assert.match(issues[`${collectionStore.rowViews[0].rowId}:id`]?.message ?? "", /id 存在重复值 dup/);
  assert.match(issues[`${collectionStore.rowViews[1].rowId}:id`]?.message ?? "", /id 存在重复值 dup/);
});

test("patchValidationSnapshotForRowField updates a non-primary-key field without rebuilding the whole snapshot", () => {
  const collectionStore = {
    rowViews: [{ rowId: "row_a" }],
    sourceIndexByRowId: new Map([["row_a", 0]]),
  };
  const fieldConfig = {
    displayTypes: { name: "Text" },
    isCompatible: (_displayType, value) => typeof value === "string",
  };
  const validationConfig = {
    primaryKeys: {},
    relations: {},
  };
  const previousSnapshot = buildValidationSnapshot({
    rows: [{ name: 1 }],
    collectionStore,
    fieldConfig,
    relationIndexes: {},
    validationConfig,
    sourcePath: "data/items.json",
    collectionPath: "$",
  });

  const nextSnapshot = patchValidationSnapshotForRowField({
    previousSnapshot,
    invalidation: { type: "row-field", rowId: "row_a", rowIndex: null, fieldName: "name" },
    rows: [{ name: "Alpha" }],
    collectionStore,
    fieldConfig,
    relationIndexes: {},
    validationConfig,
    sourcePath: "data/items.json",
    collectionPath: "$",
  });

  assert.ok(nextSnapshot);
  assert.equal(resolveValidationIssue(nextSnapshot, "row_a", 0, "name"), null);
  assert.equal(nextSnapshot.collectionIssues, previousSnapshot.collectionIssues);
});

test("patchValidationSnapshotForField rebuilds all duplicate issues for a primary-key field", () => {
  const collectionStore = {
    rowViews: [{ rowId: "row_a" }, { rowId: "row_b" }],
    sourceIndexByRowId: new Map([["row_a", 0], ["row_b", 1]]),
  };
  const fieldConfig = {
    displayTypes: {},
    isCompatible: () => true,
  };
  const validationConfig = {
    primaryKeys: {
      "data/items.json:$": "id",
    },
    relations: {},
  };
  const previousSnapshot = buildValidationSnapshot({
    rows: [{ id: "same" }, { id: "same" }],
    collectionStore,
    fieldConfig,
    relationIndexes: {},
    validationConfig,
    sourcePath: "data/items.json",
    collectionPath: "$",
  });

  const nextSnapshot = patchValidationSnapshotForField({
    previousSnapshot,
    invalidation: { type: "field", fieldName: "id" },
    rows: [{ id: "same" }, { id: "unique" }],
    collectionStore,
    fieldConfig,
    relationIndexes: {},
    validationConfig,
    sourcePath: "data/items.json",
    collectionPath: "$",
  });

  assert.ok(nextSnapshot);
  assert.equal(resolveValidationIssue(nextSnapshot, "row_a", 0, "id"), null);
  assert.equal(resolveValidationIssue(nextSnapshot, "row_b", 1, "id"), null);
});

test("applyValidationIssueOverrides overlays warning issues by row key", () => {
  const baseSnapshot = buildValidationSnapshot({
    rows: [{ trait_id: "trait_alpha" }],
    collectionStore: {
      rowViews: [{ rowId: "row_a" }],
    },
    fieldConfig: {
      displayTypes: {},
      isCompatible: () => true,
    },
    relationIndexes: {},
    validationConfig: {
      primaryKeys: {},
      relations: {},
    },
    sourcePath: "data/traits.json",
    collectionPath: "traits",
  });

  const nextSnapshot = applyValidationIssueOverrides(baseSnapshot, {
    "row_a:trait_id": { severity: "warning", message: "输入值重复，已自动改为 trait_alpha_1" },
  });

  assert.deepEqual(resolveValidationIssue(nextSnapshot, "row_a", 0, "trait_id"), {
    severity: "warning",
    message: "输入值重复，已自动改为 trait_alpha_1",
  });
});

test("applyValidationIssueOverrides removes warning issues when override is null", () => {
  const baseSnapshot = buildValidationSnapshot({
    rows: [{ trait_id: "trait_alpha" }],
    collectionStore: {
      rowViews: [{ rowId: "row_a" }],
    },
    fieldConfig: {
      displayTypes: {},
      isCompatible: () => true,
    },
    relationIndexes: {},
    validationConfig: {
      primaryKeys: {},
      relations: {},
    },
    sourcePath: "data/traits.json",
    collectionPath: "traits",
  });
  const warningSnapshot = applyValidationIssueOverrides(baseSnapshot, {
    "row_a:trait_id": { severity: "warning", message: "输入值重复，已自动改为 trait_alpha_1" },
  });

  const nextSnapshot = applyValidationIssueOverrides(warningSnapshot, {
    "row_a:trait_id": null,
  });

  assert.equal(resolveValidationIssue(nextSnapshot, "row_a", 0, "trait_id"), null);
});
