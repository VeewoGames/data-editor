import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLocalPathMigrations,
  applyPageContextPathMigrations,
  applyProfilePathMigrations,
  applyViewConfigPathMigrations,
  detectPathMigrations,
  readFingerprintCache,
  rewriteFieldViewConfigKey,
  rewriteLocalViewStorageKey,
  rewriteRelationKey,
  rewriteSharedDraftState,
  rewriteSharedViewsConfig,
  writeFingerprintCache,
} from "../src/path-migration.mjs";

const migrations = [
  {
    oldPath: "data/old/items.json",
    newPath: "data/new/items.json",
    reason: "file-move",
    confidence: "high",
  },
];

function fingerprint(path, contentHash, schemaSignature = "json:array:id,name") {
  return {
    path,
    dataSourceId: "default",
    extension: ".json",
    size: 128,
    modifiedAt: "2026-06-10T00:00:00.000Z",
    contentHash,
    schemaSignature,
  };
}

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    entries() {
      return Object.fromEntries(map.entries());
    },
  };
}

test("detectPathMigrations returns only unique high-confidence fingerprint matches", async () => {
  const previousFiles = [
    { path: "data/old/a.json", size: 128, modifiedAt: "old-a" },
    { path: "data/old/b.json", size: 128, modifiedAt: "old-b" },
    { path: "data/stable.json", size: 128, modifiedAt: "stable" },
  ];
  const nextFiles = [
    { path: "data/new/a.json", size: 128, modifiedAt: "new-a" },
    { path: "data/new/b.json", size: 128, modifiedAt: "new-b" },
    { path: "data/new/b-copy.json", size: 128, modifiedAt: "new-b-copy" },
    { path: "data/stable.json", size: 128, modifiedAt: "stable" },
  ];
  const fingerprintCache = {
    version: 1,
    files: {
      "data/old/a.json": { size: 128, modifiedAt: "old-a", fingerprint: fingerprint("data/old/a.json", "hash-a") },
      "data/old/b.json": { size: 128, modifiedAt: "old-b", fingerprint: fingerprint("data/old/b.json", "hash-b") },
    },
  };

  const result = await detectPathMigrations({
    previousFiles,
    nextFiles,
    fingerprintCache,
    readFingerprint: async (file) => fingerprint(file.path, file.path.includes("b") ? "hash-b" : "hash-a"),
  });

  assert.deepEqual(result.migrations, [
    {
      oldPath: "data/old/a.json",
      newPath: "data/new/a.json",
      reason: "file-move",
      confidence: "high",
    },
  ]);
  assert.equal(result.report.skipped.some((item) => item.reason === "fingerprint-not-unique"), true);
});

test("detectPathMigrations skips removed files when old fingerprint is missing from cache", async () => {
  const result = await detectPathMigrations({
    previousFiles: [{ path: "data/old/a.json", size: 128, modifiedAt: "old-a" }],
    nextFiles: [{ path: "data/new/a.json", size: 128, modifiedAt: "new-a" }],
    fingerprintCache: { version: 1, files: {} },
    readFingerprint: async (file) => fingerprint(file.path, "hash-a"),
  });

  assert.deepEqual(result.migrations, []);
  assert.deepEqual(result.report.skipped, [
    { surface: "detectPathMigrations", path: "data/old/a.json", reason: "fingerprint-cache-miss" },
  ]);
});

test("fingerprint cache reads and writes the dedicated localStorage key", () => {
  const storage = memoryStorage();
  const cache = {
    version: 1,
    files: {
      "data/items.json": {
        size: 128,
        modifiedAt: "now",
        fingerprint: fingerprint("data/items.json", "hash-a"),
      },
    },
  };

  const writeResult = writeFingerprintCache(storage, cache);

  assert.equal(writeResult.changed, true);
  assert.deepEqual(readFingerprintCache(storage), cache);
});

test("rewrite helpers preserve fieldPath, fieldName and encoded viewId containing colons", () => {
  const context = {
    collectionPathsByFile: {
      "data/old/items.json": ["$"],
    },
    viewIdsByCollectionKey: {
      "data/old/items.json:$": ["view:alpha"],
    },
  };

  assert.equal(
    rewriteFieldViewConfigKey("data/old/items.json:$:field:with:colon", migrations, context).value,
    "data/new/items.json:$:field:with:colon",
  );
  assert.equal(
    rewriteRelationKey("data/old/items.json:$:nested.field:with:colon", migrations, context).value,
    "data/new/items.json:$:nested.field:with:colon",
  );
  assert.equal(
    rewriteLocalViewStorageKey(
      "data-editor:data/old/items.json:$:view%3Aalpha:field:with:colon:width",
      migrations,
      context,
    ).value,
    "data-editor:data/new/items.json:$:view%3Aalpha:field:with:colon:width",
  );
});

test("shared draft state and shared views migrate collection keys without overwriting conflicts", () => {
  const oldKey = "data/old/items.json:$";
  const newKey = "data/new/items.json:$";
  const draftResult = rewriteSharedDraftState({
    lastActiveViews: { [oldKey]: "old-view", [newKey]: "new-view" },
    viewDrafts: { [oldKey]: { "view:alpha": { query: "old" } } },
    viewOrderDrafts: { [oldKey]: ["view:alpha"] },
  }, migrations);
  const sharedResult = rewriteSharedViewsConfig({
    version: 1,
    collections: {
      [oldKey]: { defaultViewId: "view:alpha", views: [{ id: "view:alpha", name: "Old" }] },
      [newKey]: { defaultViewId: "all", views: [{ id: "all", name: "All" }] },
    },
  }, migrations);

  assert.equal(draftResult.value.lastActiveViews[newKey], "new-view");
  assert.deepEqual(draftResult.value.viewDrafts[newKey], { "view:alpha": { query: "old" } });
  assert.equal(draftResult.report.conflicts.length, 1);
  assert.equal(sharedResult.value.collections[newKey].defaultViewId, "all");
  assert.equal(sharedResult.value.collections[oldKey].defaultViewId, "view:alpha");
  assert.equal(sharedResult.report.conflicts.length, 1);
});

test("rewriteSharedDraftState migrates structureDrafts collection keys together with other shared draft surfaces", () => {
  const oldKey = "data/old/items.json:$";
  const newKey = "data/new/items.json:$";

  const result = rewriteSharedDraftState({
    lastActiveViews: { [oldKey]: "view:alpha" },
    viewDrafts: {},
    viewOrderDrafts: {},
    structureDrafts: {
      [oldKey]: {
        items: [{ kind: "group", groupId: "combat", name: "Combat", icon: "shield", viewIds: ["view:alpha"] }],
      },
    },
  }, migrations);

  assert.deepEqual(result.value.structureDrafts, {
    [newKey]: {
      items: [{ kind: "group", groupId: "combat", name: "Combat", icon: "shield", viewIds: ["view:alpha"] }],
    },
  });
});

test("applyProfilePathMigrations migrates profile path surfaces", () => {
  const oldKey = "data/old/items.json:$";
  const newKey = "data/new/items.json:$";
  const result = applyProfilePathMigrations({
    fileOrder: ["data/old/items.json", "data/other.json"],
    sidebarTree: {
      childOrderByParent: { "folder:default/data/old": ["file:data/old/items.json"] },
      expandedNodeIds: ["folder:default/data/old", "file:data/old/items.json"],
    },
    lastActiveViews: { [oldKey]: "view:alpha" },
    viewDrafts: { [oldKey]: { "view:alpha": { query: "old" } } },
    viewOrderDrafts: { [oldKey]: ["view:alpha"] },
    viewLayouts: { [oldKey]: { "view:alpha": { widths: { "field:one": 120 } } } },
    collections: { [oldKey]: { hidden: ["field:one"] } },
  }, migrations);

  assert.deepEqual(result.value.fileOrder, ["data/new/items.json", "data/other.json"]);
  assert.deepEqual(result.value.sidebarTree.expandedNodeIds, ["folder:default/data/new", "file:data/new/items.json"]);
  assert.deepEqual(result.value.lastActiveViews, { [newKey]: "view:alpha" });
  assert.deepEqual(result.value.viewLayouts[newKey]["view:alpha"].widths, { "field:one": 120 });
  assert.deepEqual(result.value.collections[newKey], { hidden: ["field:one"] });
});

test("applyPageContextPathMigrations keeps grouping state and rewrites selectedPath", () => {
  const result = applyPageContextPathMigrations({
    selectedPath: "data/old/items.json",
    collectionPath: "$",
    scrollByView: {},
    expandedGroupId: "combat",
    lastActiveViewIdByGroupId: { combat: "view:alpha" },
  }, migrations);

  assert.equal(result.value.selectedPath, "data/new/items.json");
  assert.equal(result.value.expandedGroupId, "combat");
  assert.deepEqual(result.value.lastActiveViewIdByGroupId, { combat: "view:alpha" });
});

test("applyViewConfigPathMigrations migrates fields primaryKeys relations and re-syncs backlinks", () => {
  const result = applyViewConfigPathMigrations({
    fields: {
      "data/old/items.json:$:name:with:colon": { type: "Text" },
    },
    titleFields: {
      "data/old/items.json:$": "name",
    },
    primaryKeys: {
      "data/old/items.json:$": "id",
    },
    relations: {
      "data/old/items.json:$:target:ids": {
        targetFile: "data/old/items.json",
        targetCollection: "$",
        targetKey: "id",
        mode: "multi",
      },
    },
    backlinks: {
      "data/old/items.json:$:back_target:ids": {
        sourceRelation: "data/old/items.json:$:target:ids",
        displayMode: "list",
      },
      "data/stale.json:$:back_old": {
        sourceRelation: "data/stale.json:$:missing",
        displayMode: "list",
      },
    },
  }, migrations);

  assert.deepEqual(result.value.fields, {
    "data/new/items.json:$:name:with:colon": { type: "Text" },
  });
  assert.deepEqual(result.value.titleFields, {
    "data/new/items.json:$": "name",
  });
  assert.deepEqual(result.value.primaryKeys, {
    "data/new/items.json:$": "id",
  });
  assert.deepEqual(result.value.relations, {
    "data/new/items.json:$:target:ids": {
      targetFile: "data/new/items.json",
      targetCollection: "$",
      targetKey: "id",
      mode: "multi",
    },
  });
  assert.deepEqual(result.value.backlinks, {
    "data/new/items.json:$:back_target:ids": {
      sourceRelation: "data/new/items.json:$:target:ids",
      displayMode: "list",
    },
  });
});

test("applyLocalPathMigrations keeps existing new localStorage key and reports conflict", () => {
  const storage = memoryStorage({
    "data-editor:data/old/items.json:$:view%3Aalpha:name:width": "120",
    "data-editor:data/new/items.json:$:view%3Aalpha:name:width": "240",
    "data-editor:__file-order": "data/old/items.json,data/other.json",
    "data-editor:shared-view-drafts": JSON.stringify({
      lastActiveViews: { "data/old/items.json:$": "view:alpha" },
      viewDrafts: {},
      viewOrderDrafts: {},
    }),
  });

  const result = applyLocalPathMigrations(storage, migrations, {
    collectionPathsByFile: {
      "data/old/items.json": ["$"],
    },
    viewIdsByCollectionKey: {
      "data/old/items.json:$": ["view:alpha"],
    },
  });

  assert.equal(storage.getItem("data-editor:data/new/items.json:$:view%3Aalpha:name:width"), "240");
  assert.equal(storage.getItem("data-editor:data/old/items.json:$:view%3Aalpha:name:width"), "120");
  assert.equal(storage.getItem("data-editor:__file-order"), "data/new/items.json,data/other.json");
  assert.deepEqual(JSON.parse(storage.getItem("data-editor:shared-view-drafts")).lastActiveViews, {
    "data/new/items.json:$": "view:alpha",
  });
  assert.equal(result.report.conflicts.length, 1);
});

test("applyLocalPathMigrations discovers local-only non-root collection layout keys", () => {
  const storage = memoryStorage({
    "data-editor:data/old/items.json:$.items:all:name:width": "120",
    "data-editor:data/old/items.json:$.items:all:__order": "name,description",
    "data-editor:data/old/items.json:$.items:all:description:hidden": "1",
  });

  const result = applyLocalPathMigrations(storage, migrations);

  assert.equal(storage.getItem("data-editor:data/new/items.json:$.items:all:name:width"), "120");
  assert.equal(storage.getItem("data-editor:data/new/items.json:$.items:all:__order"), "name,description");
  assert.equal(storage.getItem("data-editor:data/new/items.json:$.items:all:description:hidden"), "1");
  assert.equal(storage.getItem("data-editor:data/old/items.json:$.items:all:name:width"), null);
  assert.equal(result.report.migrated.some((item) => item.surface === "localStorage"), true);
});
