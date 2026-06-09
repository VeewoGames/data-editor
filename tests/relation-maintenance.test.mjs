import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentModel, getRows } from "../src/document-model.mjs";
import { buildDocumentStore } from "../src/model/document-store.mjs";
import {
  analyzePrimaryKeyChange,
  buildPrimaryKeySyncPlan,
  collectRelationBacklinks,
  findTargetRecord,
  parseRelationKey,
} from "../src/model/relation-maintenance.mjs";

test("parseRelationKey parses source and wildcard field path", () => {
  assert.deepEqual(parseRelationKey("data/status_effects.json:$:effects.*.trigger_skill_id"), {
    sourceFile: "data/status_effects.json",
    sourceCollection: "$",
    fieldPath: ["effects", "*", "trigger_skill_id"],
  });
});

test("findTargetRecord returns matching target row", () => {
  const result = findTargetRecord([{ skill_id: "slash" }, { skill_id: "fire" }], "skill_id", "fire");
  assert.equal(result.rowIndex, 1);
  assert.deepEqual(result.row, { skill_id: "fire" });
});

test("findTargetRecord carries rowId when rows come from a document store", () => {
  const model = buildDocumentModel([
    { skill_id: "slash" },
    { skill_id: "fire" },
  ], "json", "memory://skills.json");
  const store = buildDocumentStore({ documentId: "skills", model });
  assert.ok(store.collections.get("$")?.rowViews[1].rowId);

  const result = findTargetRecord(getRows(model, "$"), "skill_id", "fire");
  assert.equal(result.rowIndex, 1);
  assert.equal(result.rowId, "skills:$:1");
});

test("collectRelationBacklinks scans scalar, array, and nested wildcard references", () => {
  const relations = {
    "data/enemies.json:enemies:skills": {
      targetFile: "data/skills.json",
      targetCollection: "skills",
      targetKey: "skill_id",
      mode: "multi",
      titleFields: ["skill_name"],
      allowMissing: false,
    },
    "data/status_effects.json:$:effects.*.trigger_skill_id": {
      targetFile: "data/skills.json",
      targetCollection: "skills",
      targetKey: "skill_id",
      mode: "single",
      titleFields: ["skill_name"],
      allowMissing: false,
    },
  };
  const documentsByPath = {
    "data/enemies.json": {
      root: {
        enemies: [
          { name: "敌人A", skills: ["slash", "fire"] },
          { name: "敌人B", skills: ["ice"] },
        ],
      },
      collections: [],
      rootKind: "array",
      format: "json",
      sourcePath: "data/enemies.json",
      rootCollectionKind: undefined,
      rootKeyField: undefined,
      metadata: [],
      __rows: null,
    },
    "data/status_effects.json": {
      root: [
        { name: "状态A", effects: [{ trigger_skill_id: "fire" }] },
      ],
      collections: [],
      rootKind: "array",
      format: "json",
      sourcePath: "data/status_effects.json",
      __rows: null,
    },
  };

  const backlinks = collectRelationBacklinks({
    targetFile: "data/skills.json",
    targetCollection: "skills",
    targetKey: "skill_id",
    targetId: "fire",
    relations,
    documentsByPath,
  });

  assert.equal(backlinks.length, 2);
  assert.equal(backlinks[0].title, "敌人A");
  assert.equal(backlinks[1].sourceFile, "data/status_effects.json");
});

test("collectRelationBacklinks carries source rowId when source rows were registered in a document store", () => {
  const sourceModel = buildDocumentModel([
    { name: "敌人A", skills: ["slash", "fire"] },
    { name: "敌人B", skills: ["ice"] },
  ], "json", "data/enemies.json");
  buildDocumentStore({ documentId: "enemies", model: sourceModel });

  const backlinks = collectRelationBacklinks({
    targetFile: "data/skills.json",
    targetCollection: "skills",
    targetKey: "skill_id",
    targetId: "fire",
    relations: {
      "data/enemies.json:$:skills": {
        targetFile: "data/skills.json",
        targetCollection: "skills",
        targetKey: "skill_id",
        mode: "multi",
        titleFields: ["skill_name"],
        allowMissing: false,
      },
    },
    documentsByPath: {
      "data/enemies.json": sourceModel,
    },
  });

  assert.equal(backlinks.length, 1);
  assert.equal(backlinks[0].rowId, "enemies:$:0");
});

test("analyzePrimaryKeyChange reports impact without mutating documents", () => {
  const source = [{ name: "敌人A", skill_id: "slash" }];
  const documentsByPath = {
    "data/enemies.json": {
      format: "json",
      sourcePath: "data/enemies.json",
      rootKind: "array",
      root: source,
      collections: [],
    },
  };
  const impact = analyzePrimaryKeyChange({
    targetFile: "data/skills.json",
    targetCollection: "skills",
    targetKey: "skill_id",
    oldValue: "slash",
    newValue: "slash_2",
    relations: {
      "data/enemies.json:$:skill_id": {
        targetFile: "data/skills.json",
        targetCollection: "skills",
        targetKey: "skill_id",
        mode: "single",
        titleFields: ["skill_name"],
        allowMissing: false,
      },
    },
    documentsByPath,
  });

  assert.equal(impact.affectedCount, 1);
  assert.equal(source[0].skill_id, "slash");
});

test("buildPrimaryKeySyncPlan rewrites only top-level single relations", () => {
  const relations = {
    "data/enemies.json:$:skill_id": {
      targetFile: "data/skills.json",
      targetCollection: "skills",
      targetKey: "skill_id",
      mode: "single",
      titleFields: ["name"],
      allowMissing: false,
    },
    "data/enemies.json:$:skills": {
      targetFile: "data/skills.json",
      targetCollection: "skills",
      targetKey: "skill_id",
      mode: "multi",
      titleFields: ["name"],
      allowMissing: false,
    },
    "data/status_effects.json:$:effects.*.trigger_skill_id": {
      targetFile: "data/skills.json",
      targetCollection: "skills",
      targetKey: "skill_id",
      mode: "single",
      titleFields: ["name"],
      allowMissing: false,
    },
  };
  const documentsByPath = {
    "data/enemies.json": {
      format: "json",
      sourcePath: "data/enemies.json",
      rootKind: "array",
      root: [{ name: "Enemy A", skill_id: "slash", skills: ["slash", "fire"] }],
      collections: [],
    },
    "data/status_effects.json": {
      format: "json",
      sourcePath: "data/status_effects.json",
      rootKind: "array",
      root: [{ name: "Burn", effects: [{ trigger_skill_id: "slash" }] }],
      collections: [],
    },
  };

  const plan = buildPrimaryKeySyncPlan({
    targetFile: "data/skills.json",
    targetCollection: "skills",
    targetKey: "skill_id",
    targetRowLabel: "Slash",
    oldValue: "slash",
    newValue: "slash_2",
    relations,
    documentsByPath,
  });

  assert.equal(plan.rewrites.length, 1);
  assert.equal(plan.rewrites[0].relationKey, "data/enemies.json:$:skill_id");
  assert.equal(plan.skipped.length, 2);
  assert.deepEqual(plan.skipped.map((item) => [item.relationKey, item.reason]), [
    ["data/enemies.json:$:skills", "unsupported-multi"],
    ["data/status_effects.json:$:effects.*.trigger_skill_id", "unsupported-nested-path"],
  ]);
});

test("buildPrimaryKeySyncPlan blocks when old and new primary key values are equal", () => {
  const plan = buildPrimaryKeySyncPlan({
    targetFile: "data/skills.json",
    targetCollection: "skills",
    targetKey: "skill_id",
    targetRowLabel: "Slash",
    oldValue: "slash",
    newValue: "slash",
    relations: {},
    documentsByPath: {},
  });

  assert.ok(plan.blockingIssues.includes("unchanged-primary-key"));
});

test("buildPrimaryKeySyncPlan ignores the edited target row when checking duplicate primary keys", () => {
  const plan = buildPrimaryKeySyncPlan({
    targetFile: "data/skills.json",
    targetCollection: "skills",
    targetKey: "skill_id",
    targetRowLabel: "Slash",
    targetRowIndex: 0,
    oldValue: "slash",
    newValue: "slash_2",
    relations: {},
    documentsByPath: {},
    targetRows: [
      { skill_id: "slash_2", name: "Slash" },
      { skill_id: "fire", name: "Fire" },
    ],
  });

  assert.ok(!plan.blockingIssues.includes("duplicate-primary-key"));
});

test("buildPrimaryKeySyncPlan ignores unrelated relation configs", () => {
  const relations = {
    "data/enemies.json:$:skill_id": {
      targetFile: "data/skills.json",
      targetCollection: "skills",
      targetKey: "skill_id",
      mode: "single",
      titleFields: ["name"],
      allowMissing: false,
    },
    "data/items.json:$:skill_id": {
      targetFile: "data/other.json",
      targetCollection: "$",
      targetKey: "other_id",
      mode: "single",
      titleFields: ["name"],
      allowMissing: false,
    },
  };
  const documentsByPath = {
    "data/enemies.json": {
      format: "json",
      sourcePath: "data/enemies.json",
      rootKind: "array",
      root: [{ name: "Enemy A", skill_id: "slash" }],
      collections: [],
    },
    "data/items.json": {
      format: "json",
      sourcePath: "data/items.json",
      rootKind: "array",
      root: [{ name: "Item A", skill_id: "slash" }],
      collections: [],
    },
  };

  const plan = buildPrimaryKeySyncPlan({
    targetFile: "data/skills.json",
    targetCollection: "skills",
    targetKey: "skill_id",
    targetRowLabel: "Slash",
    oldValue: "slash",
    newValue: "slash_2",
    relations,
    documentsByPath,
  });

  assert.equal(plan.rewrites.length, 1);
  assert.equal(plan.rewrites[0].sourceFile, "data/enemies.json");
  assert.deepEqual(plan.sourceFiles, ["data/enemies.json"]);
});

test("buildPrimaryKeySyncPlan blocks when a required source document is missing", () => {
  const plan = buildPrimaryKeySyncPlan({
    targetFile: "data/skills.json",
    targetCollection: "skills",
    targetKey: "skill_id",
    targetRowLabel: "Slash",
    oldValue: "slash",
    newValue: "slash_2",
    relations: {
      "data/enemies.json:$:skill_id": {
        targetFile: "data/skills.json",
        targetCollection: "skills",
        targetKey: "skill_id",
        mode: "single",
        titleFields: ["name"],
        allowMissing: false,
      },
    },
    documentsByPath: {},
  });

  assert.ok(plan.blockingIssues.includes("source-document-load-failed"));
});
