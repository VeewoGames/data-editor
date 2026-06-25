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

test("resolveSharedViewStructure drops stale last-active group entries that do not point to a child view", () => {
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
      lastActiveViewIdByGroupId: {
        combat: "combat",
      },
    },
  });

  assert.deepEqual(resolved.lastActiveViewIdByGroupId, {});
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
              views: [makeLeaf("damage", "伤害")],
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

test("resolveSharedViewStructure keeps top-level view icons when applying legacy flat order drafts", () => {
  const resolved = resolveSharedViewStructure({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          items: [
            makeLeaf("all", "全部", "streamlineMicroSolidBell"),
            makeLeaf("damage", "伤害", "streamlineMicroLineLeaf26423"),
            makeLeaf("utility", "功能", "json"),
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

  assert.deepEqual(resolved.topLevelItems.map((item) => item.icon), ["json", "streamlineMicroLineLeaf26423", "streamlineMicroSolidBell"]);
});

test("resolveSharedViewStructure keeps group icons when applying structure drafts", () => {
  const resolved = resolveSharedViewStructure({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "utility",
          items: [
            {
              kind: "group",
              id: "combat",
              name: "战斗",
              icon: "shield",
              views: [makeLeaf("damage", "伤害", "flame"), makeLeaf("utility", "功能", "filter")],
            },
            { kind: "view", icon: "json", view: makeView("all", "全部") },
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
            { kind: "view", viewId: "all" },
            { kind: "group", groupId: "combat", name: "战斗", viewIds: ["utility", "damage"] },
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

  assert.equal(resolved.topLevelItems[1].kind, "group");
  assert.equal(resolved.topLevelItems[1].icon, "shield");
  assert.deepEqual(resolved.topLevelItems[1].views.map((view) => view.icon), ["filter", "flame"]);
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
  assert.deepEqual(result.config.collections["data/runes.json:$"].items[1].views.map((leaf) => leaf.view.id), [result.view.id]);
  assert.equal(result.config.collections["data/runes.json:$"].items[1].views[0].icon, "borderAll");
});

test("createViewGroupConfig keeps new group ids out of the view id namespace", () => {
  const result = createViewGroupConfig({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          items: [
            { kind: "view", view: makeView("all", "全部") },
            { kind: "view", view: makeView("group", "冲突视图") },
          ],
        },
      },
    },
    collectionKey: "data/runes.json:$",
    activeViewId: "all",
    activeViewSnapshot: makeView("all", "全部"),
  });

  assert.equal(result.group.id, "group-2");
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
              views: [makeLeaf("damage", "伤害", "json")],
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
  assert.deepEqual(group.views.map((leaf) => leaf.view.id), ["damage", result.view.id]);
  assert.equal(group.views[0].icon, "json");
  assert.equal(group.views[1].icon, "borderAll");
});

test("duplicateViewGroupConfig duplicates a resolved group snapshot after the source group", () => {
  const result = duplicateViewGroupConfig({
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
              views: [
                { ...makeLeaf("damage", "伤害", "json"), view: { ...makeView("damage", "伤害"), query: "burn", sorts: [{ id: "sort-1", field: "level", direction: "asc" }] } },
                { ...makeLeaf("support", "辅助", "filter"), view: { ...makeView("support", "辅助"), query: "shield", sorts: [{ id: "sort-2", field: "rating", direction: "desc" }] } },
              ],
            },
            { kind: "view", view: makeView("utility", "功能") },
          ],
        },
      },
    },
    collectionKey: "data/runes.json:$",
    groupId: "combat",
    resolvedTopLevelItems: [
      { kind: "view", view: makeView("all", "全部") },
      {
        kind: "group",
        id: "combat",
        name: "战斗",
        views: [
          { ...makeLeaf("support", "辅助", "filter"), view: { ...makeView("support", "辅助"), query: "merged-support", sorts: [{ id: "sort-3", field: "budget", direction: "asc" }] } },
          { ...makeLeaf("damage", "伤害", "json"), view: { ...makeView("damage", "伤害"), query: "merged-damage", sorts: [{ id: "sort-4", field: "rating", direction: "desc" }] } },
        ],
      },
      { kind: "view", view: makeView("utility", "功能") },
    ],
    resolvedGroupSnapshot: {
      kind: "group",
      id: "combat",
      name: "战斗",
      views: [
        { ...makeLeaf("support", "辅助", "filter"), view: { ...makeView("support", "辅助"), query: "merged-support", sorts: [{ id: "sort-3", field: "budget", direction: "asc" }] } },
        { ...makeLeaf("damage", "伤害", "json"), view: { ...makeView("damage", "伤害"), query: "merged-damage", sorts: [{ id: "sort-4", field: "rating", direction: "desc" }] } },
      ],
    },
  });

  const items = result.config.collections["data/runes.json:$"].items;
  assert.deepEqual(items.map((item) => item.kind === "group" ? `${item.kind}:${item.name}` : `${item.kind}:${item.view.id}`), [
    "view:all",
    "group:战斗",
    "group:战斗 副本",
    "view:utility",
  ]);
  assert.equal(result.group.name, "战斗 副本");
  assert.equal(result.firstViewId, result.group.views[0].view.id);
  assert.deepEqual(result.group.views.map((leaf) => leaf.icon), ["filter", "json"]);
  assert.deepEqual(result.group.views.map((leaf) => leaf.view.name), ["辅助", "伤害"]);
  assert.deepEqual(result.group.views.map((leaf) => leaf.view.query), ["merged-support", "merged-damage"]);
  assert.deepEqual(result.group.views.map((leaf) => leaf.view.sorts), [
    [{ id: "sort-3", field: "budget", direction: "asc" }],
    [{ id: "sort-4", field: "rating", direction: "desc" }],
  ]);
  assert.deepEqual(Object.keys(result.sourceToTargetViewIdMap), ["support", "damage"]);
  assert.notEqual(result.sourceToTargetViewIdMap.support, "support");
  assert.notEqual(result.sourceToTargetViewIdMap.damage, "damage");
});

test("duplicateViewGroupConfig makes duplicated group name unique when the copy name already exists", () => {
  const result = duplicateViewGroupConfig({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          items: [
            { kind: "view", view: makeView("all", "全部") },
            { kind: "group", id: "combat", name: "战斗", views: [makeLeaf("damage", "伤害", "json")] },
            { kind: "group", id: "combat-copy", name: "战斗 副本", views: [makeLeaf("support", "辅助", "filter")] },
          ],
        },
      },
    },
    collectionKey: "data/runes.json:$",
    groupId: "combat",
    resolvedTopLevelItems: [
      { kind: "view", view: makeView("all", "全部") },
      { kind: "group", id: "combat", name: "战斗", views: [makeLeaf("damage", "伤害", "json")] },
      { kind: "group", id: "combat-copy", name: "战斗 副本", views: [makeLeaf("support", "辅助", "filter")] },
    ],
    resolvedGroupSnapshot: {
      kind: "group",
      id: "combat",
      name: "战斗",
      views: [makeLeaf("damage", "伤害", "json")],
    },
  });

  assert.equal(result.group.name, "战斗 副本 2");
});

test("duplicateViewGroupConfig keeps duplicated group ids out of the view id namespace", () => {
  const result = duplicateViewGroupConfig({
    sharedViewsConfig: {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          items: [
            { kind: "view", view: makeView("all", "全部") },
            { kind: "view", view: makeView("combat-2", "冲突顶层视图") },
            { kind: "group", id: "combat", name: "战斗", views: [makeLeaf("damage", "伤害", "json")] },
          ],
        },
      },
    },
    collectionKey: "data/runes.json:$",
    groupId: "combat",
    resolvedTopLevelItems: [
      { kind: "view", view: makeView("all", "全部") },
      { kind: "view", view: makeView("combat-2", "冲突顶层视图") },
      { kind: "group", id: "combat", name: "战斗", views: [makeLeaf("damage", "伤害", "json")] },
    ],
    resolvedGroupSnapshot: {
      kind: "group",
      id: "combat",
      name: "战斗",
      views: [makeLeaf("damage", "伤害", "json")],
    },
  });

  assert.equal(result.group.id, "combat-3");
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
            { kind: "group", id: "combat", name: "战斗", views: [makeLeaf("damage", "伤害", "json")] },
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
            { kind: "group", id: "combat", name: "战斗", views: [makeLeaf("damage", "伤害", "json"), makeLeaf("support", "辅助", "filter")] },
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
  assert.deepEqual(
    result.collections["data/runes.json:$"].items
      .filter((item) => item.kind === "view")
      .map((item) => item.icon),
    ["borderAll", "json", "filter", "borderAll"],
  );
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
      { kind: "group", groupId: "combat", name: "战斗", icon: "folder", viewIds: ["utility", "damage"] },
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
      { kind: "group", groupId: "combat", name: "战斗", icon: "folder", viewIds: ["speed", "damage", "utility"] },
    ],
  });
});

test("draftSharedViewStructure reorders a top-level group before another top-level item", () => {
  const result = draftSharedViewStructure({
    draftState: {
      lastActiveViews: {},
      viewDrafts: {},
      viewOrderDrafts: {},
      structureDrafts: {},
    },
    collectionKey: "data/runes.json:$",
    topLevelItems: [
      { kind: "view", view: { ...allView, id: "all", name: "全部" } },
      {
        kind: "group",
        id: "combat",
        name: "战斗",
        views: [
          { ...allView, id: "damage", name: "伤害" },
          { ...allView, id: "utility", name: "辅助" },
        ],
      },
      { kind: "view", view: { ...allView, id: "support", name: "支援" } },
    ],
    operation: {
      type: "top-level-group",
      sourceGroupId: "combat",
      targetItemId: "support",
      placement: "before",
    },
  });

  assert.deepEqual(result.structureDrafts["data/runes.json:$"], {
    items: [
      { kind: "view", viewId: "all" },
      { kind: "group", groupId: "combat", name: "战斗", icon: "folder", viewIds: ["damage", "utility"] },
      { kind: "view", viewId: "support" },
    ],
  });
});
