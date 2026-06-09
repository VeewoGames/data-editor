import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentModel } from "../src/document-model.mjs";
import {
  buildPrimaryKeySyncSaveSnapshot,
  describePrimaryKeySyncBlockingIssues,
  describePrimaryKeySyncSaveResult,
} from "../src/model/primary-key-sync-save.mjs";

test("buildPrimaryKeySyncSaveSnapshot rewrites same-file relation rows inside the current pending save", async () => {
  const currentModel = buildDocumentModel([
    { id: "a", target_id: "b", name: "Alpha" },
    { id: "b2", target_id: null, name: "Beta" },
  ], "json", "data/items.json");
  let loadCount = 0;

  const snapshot = await buildPrimaryKeySyncSaveSnapshot({
    plan: {
      targetFile: "data/items.json",
      targetCollection: "$",
      targetKey: "id",
      targetRowLabel: "Beta",
      oldValue: "b",
      newValue: "b2",
      sourceFiles: ["data/items.json"],
      matchedBacklinks: [],
      rewrites: [{
        relationKey: "data/items.json:$:target_id",
        sourceFile: "data/items.json",
        sourceCollection: "$",
        fieldPath: ["target_id"],
        rowIndex: 0,
        rowLabel: "Alpha",
        oldValue: "b",
        newValue: "b2",
      }],
      skipped: [],
      blockingIssues: [],
      warnings: [],
    },
    currentModel,
    currentPath: "data/items.json",
    loadDocument: async () => {
      loadCount += 1;
      throw new Error("should not load current document");
    },
  });

  assert.equal(loadCount, 0);
  assert.equal(snapshot.pendingSaves.length, 1);
  assert.equal(snapshot.pendingSaves[0].path, "data/items.json");
  assert.equal(snapshot.pendingSaves[0].root[0].target_id, "b2");
  assert.equal(currentModel.root[0].target_id, "b");
});

test("buildPrimaryKeySyncSaveSnapshot loads each external source once and applies rewrites", async () => {
  const currentModel = buildDocumentModel([
    { skill_id: "slash_2", name: "Slash" },
  ], "json", "data/skills.json");
  const sourceModel = buildDocumentModel([
    { id: "enemy_a", skill_id: "slash", name: "Enemy A" },
  ], "json", "data/enemies.json");
  let loadCount = 0;

  const snapshot = await buildPrimaryKeySyncSaveSnapshot({
    plan: {
      targetFile: "data/skills.json",
      targetCollection: "$",
      targetKey: "skill_id",
      targetRowLabel: "Slash",
      oldValue: "slash",
      newValue: "slash_2",
      sourceFiles: ["data/enemies.json"],
      matchedBacklinks: [],
      rewrites: [{
        relationKey: "data/enemies.json:$:skill_id",
        sourceFile: "data/enemies.json",
        sourceCollection: "$",
        fieldPath: ["skill_id"],
        rowIndex: 0,
        rowLabel: "Enemy A",
        oldValue: "slash",
        newValue: "slash_2",
      }],
      skipped: [],
      blockingIssues: [],
      warnings: [],
    },
    currentModel,
    currentPath: "data/skills.json",
    loadDocument: async (path) => {
      loadCount += 1;
      assert.equal(path, "data/enemies.json");
      return sourceModel;
    },
  });

  assert.equal(loadCount, 1);
  assert.deepEqual(snapshot.pendingSaves.map((item) => item.path), ["data/skills.json", "data/enemies.json"]);
  assert.equal(snapshot.pendingSaves[1].root[0].skill_id, "slash_2");
  assert.equal(sourceModel.root[0].skill_id, "slash");
});

test("primary key sync description helpers expose shared dialog and status copy", () => {
  assert.equal(describePrimaryKeySyncBlockingIssues({
    blockingIssues: ["duplicate-primary-key", "source-document-load-failed"],
  }), "新主键与当前集合中的已有主键冲突。 存在来源文件读取失败，当前不能执行同步保存。");

  assert.equal(describePrimaryKeySyncSaveResult({
    ok: false,
    savedPaths: ["data/skills.json"],
    failedPath: "data/enemies.json",
    errorMessage: "disk full",
  }), "已成功：data/skills.json。失败文件：data/enemies.json。原因：disk full 当前磁盘状态可能已部分更新。");
});
