import test from "node:test";
import assert from "node:assert/strict";
import {
  createViewGroupConfig,
  createViewInGroupConfig,
  draftSharedViewStructure,
  duplicateViewGroupConfig,
  deleteViewGroupConfig,
  renameViewGroupConfig,
  resolveSharedViewStructure,
} from "../src/view/shared-view-structure.mjs";

const allView = {
  id: "all",
  name: "全部",
  type: "table",
  query: "",
  filters: { topLevelRules: [], advancedRoot: null },
  sorts: [],
  hidden: [],
  wrapped: [],
  order: [],
  detailOrder: [],
  widths: {},
};

function makeView(id, name = id) {
  return {
    ...allView,
    id,
    name,
  };
}

function makeLeaf(id, name = id, icon = "borderAll") {
  return {
    kind: "view",
    icon,
    view: makeView(id, name),
  };
}

test("resolveSharedViewStructure expands the parent group of the active child view", () => {
  const resolved = resolveSharedViewStructure({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          items: [
            { kind: "view", view: makeView("all", "全部") },
            {
              kind: "group",
              id: "combat",
              name: "战斗",
              views: [makeLeaf("damage", "伤害"), makeLeaf("support", "辅助")],
            },
            { kind: "view", view: makeView("utility", "功能") },
          ],
        },
      },
    },
    collectionKey: "data/runes.json:$",
    draftState: {
      lastActiveViews: { "data/runes.json:$": "support" },
      viewDrafts: {},
      viewOrderDrafts: {},
      structureDrafts: {},
    },
    pageContext: {
      selectedPath: "data/runes.json",
      collectionPath: "$",
      scrollByView: {},
      expandedGroupId: null,
      lastActiveViewIdByGroupId: {},
    },
  });

  assert.equal(resolved.activeViewId, "support");
  assert.equal(resolved.activeGroupId, "combat");
  assert.equal(resolved.expandedGroupId, "combat");
  assert.deepEqual(resolved.flattenedViews.map((view) => view.id), ["all", "damage", "support", "utility"]);
  assert.equal(resolved.parentGroupIdByViewId.support, "combat");
  assert.equal(resolved.parentGroupIdByViewId.utility, null);
});

test("resolveSharedViewStructure applies structure drafts before flattening groups", () => {
  const resolved = resolveSharedViewStructure({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          items: [
            { kind: "view", view: makeView("all", "全部") },
            {
              kind: "group",
              id: "combat",
              name: "战斗",
              views: [makeLeaf("damage", "伤害")],
            },
            { kind: "view", view: makeView("utility", "功能") },
          ],
        },
      },
    },
    collectionKey: "data/runes.json:$",
    draftState: {
      lastActiveViews: { "data/runes.json:$": "utility" },
      viewDrafts: {},
      viewOrderDrafts: {},
      structureDrafts: {
        "data/runes.json:$": {
          items: [
            { kind: "group", groupId: "combat", name: "战斗组", viewIds: ["utility", "damage"] },
            { kind: "view", viewId: "all" },
          ],
        },
      },
    },
    pageContext: {
      selectedPath: "data/runes.json",
      collectionPath: "$",
      scrollByView: {},
      expandedGroupId: "combat",
      lastActiveViewIdByGroupId: { combat: "utility" },
    },
  });

  assert.deepEqual(resolved.topLevelItems.map((item) => item.kind === "group" ? `${item.kind}:${item.id}` : `${item.kind}:${item.view.id}`), [
    "group:combat",
    "view:all",
  ]);
  assert.deepEqual(resolved.topLevelItems[0].views.map((view) => view.view.id), ["utility", "damage"]);
  assert.equal(resolved.activeViewId, "utility");
  assert.equal(resolved.expandedGroupId, "combat");
});

test("resolveSharedViewStructure uses preferredViewId before lastActiveViews", () => {
  const resolved = resolveSharedViewStructure({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          items: [
            { kind: "view", view: makeView("all", "全部") },
            {
              kind: "group",
              id: "combat",
              name: "战斗",
              views: [makeLeaf("damage", "伤害"), makeLeaf("support", "辅助")],
            },
          ],
        },
      },
    },
    collectionKey: "data/runes.json:$",
    draftState: {
      lastActiveViews: { "data/runes.json:$": "all" },
      viewDrafts: {},
      viewOrderDrafts: {},
      structureDrafts: {},
    },
    pageContext: {
      selectedPath: "data/runes.json",
      collectionPath: "$",
      scrollByView: {},
      expandedGroupId: null,
      lastActiveViewIdByGroupId: {},
    },
    preferredViewId: "support",
  });

  assert.equal(resolved.activeViewId, "support");
  assert.equal(resolved.activeGroupId, "combat");
  assert.equal(resolved.expandedGroupId, "combat");
});

test("resolveSharedViewStructure ignores invalid preferredViewId and falls back to lastActiveViews", () => {
  const resolved = resolveSharedViewStructure({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          items: [
            { kind: "view", view: makeView("all", "全部") },
            {
              kind: "group",
              id: "combat",
              name: "战斗",
              views: [makeLeaf("damage", "伤害"), makeLeaf("support", "辅助")],
            },
          ],
        },
      },
    },
    collectionKey: "data/runes.json:$",
    draftState: {
      lastActiveViews: { "data/runes.json:$": "damage" },
      viewDrafts: {},
      viewOrderDrafts: {},
      structureDrafts: {},
    },
    pageContext: {
      selectedPath: "data/runes.json",
      collectionPath: "$",
      scrollByView: {},
      expandedGroupId: null,
      lastActiveViewIdByGroupId: {},
    },
    preferredViewId: "missing",
  });

  assert.equal(resolved.activeViewId, "damage");
  assert.equal(resolved.activeGroupId, "combat");
  assert.equal(resolved.expandedGroupId, "combat");
});

test("createViewGroupConfig assigns neutral incremental ids to new child views", () => {
  const result = createViewGroupConfig({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/skills.json:skills": {
          defaultViewId: "tag-melee-copy-copy-2",
          items: [
            { kind: "view", view: makeView("tag-melee-copy-copy-2", "近战") },
            { kind: "view", view: makeView("view-1", "旧副本") },
          ],
        },
      },
    },
    collectionKey: "data/skills.json:skills",
    activeViewId: "tag-melee-copy-copy-2",
    activeViewSnapshot: makeView("tag-melee-copy-copy-2", "近战"),
  });

  assert.equal(result.view.id, "view-2");
  assert.equal(result.group.views[0].view.id, "view-2");
});

test("duplicateViewGroupConfig assigns neutral incremental ids to duplicated child views", () => {
  const result = duplicateViewGroupConfig({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/skills.json:skills": {
          defaultViewId: "tag-melee",
          items: [
            {
              kind: "group",
              id: "combat",
              name: "战斗",
              views: [makeLeaf("tag-melee-copy-copy-2", "近战"), makeLeaf("view-1", "旧副本")],
            },
            { kind: "view", view: makeView("view-2", "已存在 2") },
          ],
        },
      },
    },
    collectionKey: "data/skills.json:skills",
    groupId: "combat",
    resolvedTopLevelItems: [
      {
        kind: "group",
        id: "combat",
        name: "战斗",
        views: [makeLeaf("tag-melee-copy-copy-2", "近战"), makeLeaf("view-1", "旧副本")],
      },
      { kind: "view", view: makeView("view-2", "已存在 2") },
    ],
    resolvedGroupSnapshot: {
      kind: "group",
      id: "combat",
      name: "战斗",
      views: [makeLeaf("tag-melee-copy-copy-2", "近战"), makeLeaf("view-1", "旧副本")],
    },
  });

  assert.deepEqual(result.group.views.map((leaf) => leaf.view.id), ["view-3", "view-4"]);
});
