import test from "node:test";
import assert from "node:assert/strict";
import {
  createViewGroupConfig,
  createViewInGroupConfig,
  draftSharedViewStructure,
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
              views: [makeView("damage", "伤害"), makeView("support", "辅助")],
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
              views: [makeView("damage", "伤害")],
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
  assert.deepEqual(resolved.topLevelItems[0].views.map((view) => view.id), ["utility", "damage"]);
  assert.equal(resolved.activeViewId, "utility");
  assert.equal(resolved.expandedGroupId, "combat");
});

test("resolveSharedViewStructure collapses stale expanded groups when the active view is top-level", () => {
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
              views: [makeView("damage", "伤害")],
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
      expandedGroupId: "combat",
      lastActiveViewIdByGroupId: { combat: "damage" },
    },
  });

  assert.equal(resolved.activeViewId, "all");
  assert.equal(resolved.activeGroupId, null);
  assert.equal(resolved.expandedGroupId, null);
});

test("resolveSharedViewStructure keeps legacy flat order drafts working for top-level views", () => {
  const resolved = resolveSharedViewStructure({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          items: [
            { kind: "view", view: makeView("all", "全部") },
            { kind: "view", view: makeView("damage", "伤害") },
            { kind: "view", view: makeView("utility", "功能") },
          ],
        },
      },
    },
    collectionKey: "data/runes.json:$",
    draftState: {
      lastActiveViews: { "data/runes.json:$": "utility" },
      viewDrafts: {},
      viewOrderDrafts: {
        "data/runes.json:$": ["utility", "damage", "all"],
      },
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

  assert.deepEqual(resolved.topLevelItems.map((item) => item.view.id), ["utility", "damage", "all"]);
  assert.deepEqual(resolved.flattenedViews.map((view) => view.id), ["utility", "damage", "all"]);
});

test("createViewGroupConfig inserts a new non-empty group after the active top-level item", () => {
  const result = createViewGroupConfig({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          items: [
            { kind: "view", view: makeView("all", "全部") },
            { kind: "view", view: makeView("utility", "功能") },
          ],
        },
      },
    },
    collectionKey: "data/runes.json:$",
    activeViewId: "all",
    activeViewSnapshot: makeView("all", "全部"),
  });

  assert.equal(result.group.name, "新分组");
  assert.equal(result.view.name, "新视图");
  assert.deepEqual(result.config.collections["data/runes.json:$"].items.map((item) => item.kind === "group" ? `group:${item.id}` : `view:${item.view.id}`), [
    "view:all",
    `group:${result.group.id}`,
    "view:utility",
  ]);
  assert.deepEqual(result.config.collections["data/runes.json:$"].items[1].views.map((view) => view.id), [result.view.id]);
});

test("createViewInGroupConfig appends a new child view to the target group", () => {
  const result = createViewInGroupConfig({
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
              views: [makeView("damage", "伤害")],
            },
          ],
        },
      },
    },
    collectionKey: "data/runes.json:$",
    groupId: "combat",
    activeViewSnapshot: makeView("damage", "伤害"),
  });

  const group = result.config.collections["data/runes.json:$"].items[1];
  assert.equal(group.kind, "group");
  assert.equal(result.view.name, "新视图");
  assert.deepEqual(group.views.map((view) => view.id), ["damage", result.view.id]);
});

test("renameViewGroupConfig updates only the target group name", () => {
  const result = renameViewGroupConfig({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          items: [
            { kind: "view", view: makeView("all", "全部") },
            { kind: "group", id: "combat", name: "战斗", views: [makeView("damage", "伤害")] },
          ],
        },
      },
    },
    collectionKey: "data/runes.json:$",
    groupId: "combat",
    name: "输出",
  });

  assert.equal(result.collections["data/runes.json:$"].items[1].name, "输出");
});

test("deleteViewGroupConfig lifts child views into the top level near the original group", () => {
  const result = deleteViewGroupConfig({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "damage",
          items: [
            { kind: "view", view: makeView("all", "全部") },
            { kind: "group", id: "combat", name: "战斗", views: [makeView("damage", "伤害"), makeView("support", "辅助")] },
            { kind: "view", view: makeView("utility", "功能") },
          ],
        },
      },
    },
    collectionKey: "data/runes.json:$",
    groupId: "combat",
  });

  assert.deepEqual(result.collections["data/runes.json:$"].items.map((item) => item.kind === "group" ? item.id : item.view.id), [
    "all",
    "damage",
    "support",
    "utility",
  ]);
});

test("draftSharedViewStructure moves a top-level view into a group and clears legacy order draft", () => {
  const result = draftSharedViewStructure({
    draftState: {
      lastActiveViews: {},
      viewDrafts: {},
      viewOrderDrafts: { "data/runes.json:$": ["all", "damage", "utility"] },
      structureDrafts: {},
    },
    collectionKey: "data/runes.json:$",
    topLevelItems: [
      { kind: "view", view: { ...allView, id: "all", name: "全部" } },
      { kind: "view", view: { ...allView, id: "damage", name: "伤害" } },
      { kind: "group", id: "combat", name: "战斗", views: [{ ...allView, id: "utility", name: "辅助" }] },
    ],
    operation: {
      type: "group",
      sourceViewId: "damage",
      groupId: "combat",
      placement: "append",
    },
  });

  assert.deepEqual(result.viewOrderDrafts, {});
  assert.deepEqual(result.structureDrafts["data/runes.json:$"], {
    items: [
      { kind: "view", viewId: "all" },
      { kind: "group", groupId: "combat", name: "战斗", viewIds: ["utility", "damage"] },
    ],
  });
});

test("draftSharedViewStructure moves a grouped view out to the top level and removes empty groups", () => {
  const result = draftSharedViewStructure({
    draftState: {
      lastActiveViews: {},
      viewDrafts: {},
      viewOrderDrafts: {},
      structureDrafts: {},
    },
    collectionKey: "data/runes.json:$",
    topLevelItems: [
      { kind: "group", id: "combat", name: "战斗", views: [{ ...allView, id: "damage", name: "伤害" }] },
      { kind: "view", view: { ...allView, id: "utility", name: "辅助" } },
    ],
    operation: {
      type: "top-level",
      sourceViewId: "damage",
      targetItemId: "utility",
      placement: "before",
    },
  });

  assert.deepEqual(result.structureDrafts["data/runes.json:$"], {
    items: [
      { kind: "view", viewId: "damage" },
      { kind: "view", viewId: "utility" },
    ],
  });
});

test("draftSharedViewStructure reorders within the same group", () => {
  const result = draftSharedViewStructure({
    draftState: {
      lastActiveViews: {},
      viewDrafts: {},
      viewOrderDrafts: {},
      structureDrafts: {},
    },
    collectionKey: "data/runes.json:$",
    topLevelItems: [
      {
        kind: "group",
        id: "combat",
        name: "战斗",
        views: [
          { ...allView, id: "damage", name: "伤害" },
          { ...allView, id: "utility", name: "辅助" },
          { ...allView, id: "speed", name: "速度" },
        ],
      },
    ],
    operation: {
      type: "group",
      sourceViewId: "speed",
      groupId: "combat",
      targetViewId: "damage",
      placement: "before",
    },
  });

  assert.deepEqual(result.structureDrafts["data/runes.json:$"], {
    items: [
      { kind: "group", groupId: "combat", name: "战斗", viewIds: ["speed", "damage", "utility"] },
    ],
  });
});
