import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as viewState from "../src/view/view-state.mjs";

const {
  applyViewOrderDraft,
  clearViewDraft,
  collectionConfigKey,
  hasViewDraft,
  mergeSharedViewWithDraft,
  resolveActiveView,
  resolveCollectionViews,
  resolveDefaultViewId,
} = viewState;

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

test("collectionConfigKey joins file path and collection path", () => {
  assert.equal(collectionConfigKey("data/runes.json", "$.items"), "data/runes.json:$.items");
});

test("App wires shared view filter bar draft changes through active view drafts", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const filterBarSource = await readFile(new URL("../src/components/ViewFilterBar.tsx", import.meta.url), "utf8");
  const sortPopoverSource = await readFile(new URL("../src/components/sort/SortPopover.tsx", import.meta.url), "utf8");
  const multiSelectFilterSource = await readFile(new URL("../src/components/filters/MultiSelectFilterPopover.tsx", import.meta.url), "utf8");
  const booleanFilterSource = await readFile(new URL("../src/components/filters/BooleanFilterPopover.tsx", import.meta.url), "utf8");
  const textFilterSource = await readFile(new URL("../src/components/filters/TextFilterPopover.tsx", import.meta.url), "utf8");

  const mainContentSection = appSource.slice(
    appSource.indexOf("<div className=\"main-content\">"),
    appSource.indexOf("<DataTable"),
  );

  assert.match(appSource, /import \{ ViewFilterBar, type ViewFilterBarSnapshot \} from "\.\/components\/ViewFilterBar";/);
  assert.match(mainContentSection, /<ViewFilterBar/);
  assert.match(appSource, /const viewFilterBarSnapshot = useMemo<ViewFilterBarSnapshot>\(\(\) => \(\{/);
  assert.match(appSource, /view: activeView,/);
  assert.match(appSource, /fields: allFields,/);
  assert.match(appSource, /relationFilterOptions: viewFilterOptions,/);
  assert.match(mainContentSection, /onChangeFilters=\{\(filters\) => updateActiveViewDraft\(\{ filters \}\)\}/);
  assert.match(mainContentSection, /onChangeSorts=\{\(sorts\) => updateActiveViewDraft\(\{ sorts \}\)\}/);
  assert.match(filterBarSource, /export type ViewFilterBarProps = \{/);
  assert.match(filterBarSource, /view: CollectionView \| null;/);
  assert.match(filterBarSource, /relationFilterOptions\?: Record<string, MultiSelectOptionView\[\]>;/);
  assert.match(filterBarSource, /if \(!view\) return null;/);
  assert.match(filterBarSource, /<Popover\.Root open=\{addFilterOpen\}/);
  assert.match(filterBarSource, /add-filter-field-option/);
  assert.match(filterBarSource, /onChangeFilters: \(filters: FilterGroup\) => void;/);
  assert.match(filterBarSource, /createDefaultFilterRule/);
  assert.match(filterBarSource, /import \{ optionsForField, resolveFieldType \} from "\.\/filters\/filter-rule-ui";/);
  assert.match(filterBarSource, /const fieldType = resolveFieldType\(field, displayTypes, fieldViewConfigs, fieldTypes\);/);
  assert.match(filterBarSource, /optionsForField\(rule\.field, fieldType, fieldViewConfigs, relationFilterOptions\)/);
  assert.match(appSource, /viewConfig\.relations\[buildRelationKey\(\{ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: \[field\] \}\)\]/);
  assert.match(appSource, /relationOptions\[relationKey\] \?\? \[\]/);
  assert.match(appSource, /buildValueFilterOptions\(field, rows, fieldViewConfigs\[field\], fieldType\)/);
  assert.match(sortPopoverSource, /onChangeSorts\(nextSorts\)/);
  assert.match(sortPopoverSource, /sorts\.map/);
  assert.match(booleanFilterSource, /onClick=\{deleteRule\}/);
  assert.doesNotMatch(booleanFilterSource, /operator: "is_empty"/);

  for (const source of [filterBarSource, sortPopoverSource, multiSelectFilterSource, booleanFilterSource, textFilterSource]) {
    assert.doesNotMatch(source, /高级筛选|合并筛选|嵌套筛选|filter merge|advanced filter/i);
  }
});

test("App compares view filters with sameViewFilters instead of sameFilterGroup", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(appSource, /function sameViewFilters\(/);
  assert.doesNotMatch(appSource, /function sameFilterGroup\(/);
});

test("handleAddFilter no longer blocks duplicate field names", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const section = appSource.slice(
    appSource.indexOf("function handleAddFilter"),
    appSource.indexOf("function handleCommitMultiSelectOptionFieldDraft"),
  );

  assert.doesNotMatch(section, /currentRules\.some\(\(rule\) => rule\.field === fieldName\)/);
});

test("ViewFilterBar renders advanced filter chip and does not dedupe fields", async () => {
  const filterBarSource = await readFile(new URL("../src/components/ViewFilterBar.tsx", import.meta.url), "utf8");

  assert.match(filterBarSource, /advancedRoot/);
  assert.match(filterBarSource, /AdvancedFilterPanel/);
  assert.doesNotMatch(filterBarSource, /fields\.filter\(\(field\) => !visibleFilterRules\.some\(\(rule\) => rule\.field === field\)\)/);
});

test("FilterActionMenu exposes merge into advanced filter action", async () => {
  const source = await readFile(new URL("../src/components/filters/FilterActionMenu.tsx", import.meta.url), "utf8");

  assert.match(source, /合并到高级筛选中/);
});

test("pendingOpenFilterRuleId only targets top-level quick chips", async () => {
  const source = await readFile(new URL("../src/components/ViewFilterBar.tsx", import.meta.url), "utf8");

  assert.match(source, /topLevelRules/);
  assert.doesNotMatch(source, /advancedRoot\.children\.some\(\(rule\) => rule\.id === autoOpenRuleId\)/);
});

test("mergeSharedViewWithDraft overlays only normalized draft fields", () => {
  const sharedView = {
    ...allView,
    id: "damage",
    name: "Damage",
    query: "base",
    hidden: ["internal"],
  };

  assert.deepEqual(mergeSharedViewWithDraft(sharedView, {
    id: "ignored",
    name: "Ignored",
    type: "board",
    query: "fire",
    hidden: ["icon"],
    widths: { power: 120.6 },
  }), {
    ...sharedView,
    query: "fire",
    hidden: ["icon"],
    widths: { power: 121 },
  });
});

test("mergeSharedViewWithDraft keeps duplicate-field rules and advancedRoot", () => {
  const sharedView = {
    ...allView,
    filters: {
      topLevelRules: [],
      advancedRoot: null,
    },
  };

  const merged = mergeSharedViewWithDraft(sharedView, {
    filters: {
      topLevelRules: [
        { kind: "rule", id: "a", field: "skill_category", operator: "is", value: "general" },
        { kind: "rule", id: "b", field: "skill_category", operator: "is_not", value: "summon" },
      ],
      advancedRoot: null,
    },
  });

  assert.equal(merged.filters.topLevelRules.length, 2);
  assert.deepEqual(merged.filters.advancedRoot, null);
});

test("applyViewOrderDraft reorders known ids and appends missing views", () => {
  const views = [
    { id: "all" },
    { id: "damage" },
    { id: "utility" },
  ];

  assert.deepEqual(applyViewOrderDraft(views, ["utility", "missing", "damage"]).map((view) => view.id), [
    "utility",
    "damage",
    "all",
  ]);
});

test("resolveActiveView prefers last active then default then first view", () => {
  const views = [
    { id: "all" },
    { id: "damage" },
    { id: "utility" },
  ];

  assert.deepEqual(resolveActiveView(views, "damage", "utility"), { id: "damage" });
  assert.deepEqual(resolveActiveView(views, "missing", "utility"), { id: "utility" });
  assert.deepEqual(resolveActiveView(views, "missing", "also-missing"), { id: "all" });
  assert.equal(resolveActiveView([], "damage", "utility"), null);
});

test("resolveCollectionViews creates default all view when collection is missing or empty", () => {
  assert.deepEqual(resolveCollectionViews({ collections: {} }, "data/runes.json:$"), [allView]);
  assert.deepEqual(resolveCollectionViews({
    collections: {
      "data/runes.json:$": { views: [] },
    },
  }, "data/runes.json:$"), [allView]);
});

test("resolveDefaultViewId falls back when configured default is missing", () => {
  const config = {
    collections: {
      "data/runes.json:$": {
        defaultViewId: "missing",
        views: [
          { ...allView, id: "all" },
          { ...allView, id: "damage" },
        ],
      },
    },
  };

  assert.equal(resolveDefaultViewId(config, "data/runes.json:$"), "all");
  config.collections["data/runes.json:$"].defaultViewId = "damage";
  assert.equal(resolveDefaultViewId(config, "data/runes.json:$"), "damage");
});

test("clearViewDraft preserves other view drafts and clears collection order draft", () => {
  const draftState = {
    lastActiveViews: { "data/runes.json:$": "damage" },
    viewDrafts: {
      "data/runes.json:$": {
        damage: { query: "fire" },
        utility: { hidden: ["debug"] },
      },
      "data/keywords.json:$": {
        all: { query: "shadow" },
      },
    },
    viewOrderDrafts: {
      "data/runes.json:$": ["utility", "damage"],
      "data/keywords.json:$": ["all"],
    },
  };

  const next = clearViewDraft(draftState, "data/runes.json:$", "damage");

  assert.notEqual(next, draftState);
  assert.deepEqual(next, {
    lastActiveViews: { "data/runes.json:$": "damage" },
    structureDrafts: {},
    viewDrafts: {
      "data/runes.json:$": {
        utility: { hidden: ["debug"] },
      },
      "data/keywords.json:$": {
        all: { query: "shadow" },
      },
    },
    viewOrderDrafts: {
      "data/keywords.json:$": ["all"],
    },
  });
  assert.deepEqual(draftState.viewDrafts["data/runes.json:$"].damage, { query: "fire" });
});

test("hasViewDraft detects view draft, collection order draft, or structure draft", () => {
  const draftState = {
    viewDrafts: {
      "data/runes.json:$": {
        damage: { query: "fire" },
      },
    },
    viewOrderDrafts: {
      "data/keywords.json:$": ["all"],
    },
    structureDrafts: {
      "data/skills.json:$": {
        items: [{ kind: "group", groupId: "combat", viewIds: ["all"] }],
      },
    },
  };

  assert.equal(hasViewDraft(draftState, "data/runes.json:$", "damage"), true);
  assert.equal(hasViewDraft(draftState, "data/keywords.json:$", "all"), true);
  assert.equal(hasViewDraft(draftState, "data/skills.json:$", "all"), true);
  assert.equal(hasViewDraft(draftState, "data/runes.json:$", "utility"), false);
});

test("resetActiveSharedViewDraft clears active draft and reports remaining dirty state", () => {
  const draftState = {
    lastActiveViews: { "data/runes.json:$": "damage" },
    viewDrafts: {
      "data/runes.json:$": {
        damage: { query: "fire" },
      },
      "data/keywords.json:$": {
        all: { query: "shadow" },
      },
    },
    viewOrderDrafts: {
      "data/runes.json:$": ["damage", "all"],
    },
    structureDrafts: {
      "data/runes.json:$": {
        items: [{ kind: "view", viewId: "damage" }, { kind: "view", viewId: "all" }],
      },
    },
  };

  assert.equal(typeof viewState.resetActiveSharedViewDraft, "function");

  const result = viewState.resetActiveSharedViewDraft(draftState, "data/runes.json:$", "damage");

  assert.deepEqual(result, {
    draftState: {
      lastActiveViews: { "data/runes.json:$": "damage" },
      viewDrafts: {
        "data/keywords.json:$": {
          all: { query: "shadow" },
        },
      },
      viewOrderDrafts: {},
      structureDrafts: {},
    },
    dirty: true,
  });

  assert.deepEqual(viewState.resetActiveSharedViewDraft(result.draftState, "data/keywords.json:$", "all"), {
    draftState: {
      lastActiveViews: { "data/runes.json:$": "damage" },
      viewDrafts: {},
      viewOrderDrafts: {},
      structureDrafts: {},
    },
    dirty: false,
  });
});

test("createSharedViewConfig inserts snapshot after active view without clearing active draft", () => {
  assert.equal(typeof viewState.createSharedViewConfig, "function");
  const config = {
    version: 1,
    collections: {
      "data/runes.json:$": {
        defaultViewId: "all",
        views: [
          { ...allView, id: "all", name: "All" },
          { ...allView, id: "damage", name: "Damage", query: "base" },
        ],
      },
    },
  };
  const activeSnapshot = { ...allView, id: "damage", name: "Damage", query: "fire", hidden: ["debug"] };
  const result = viewState.createSharedViewConfig(config, "data/runes.json:$", "damage", activeSnapshot);

  assert.deepEqual(result.config.collections["data/runes.json:$"].items.map((item) => item.view.id), [
    "all",
    "damage",
    result.view.id,
  ]);
  assert.equal(result.view.name, "Damage copy");
  assert.equal(result.view.query, "fire");
  assert.deepEqual(result.view.hidden, ["debug"]);
  assert.deepEqual(config.collections["data/runes.json:$"].views.map((view) => view.id), ["all", "damage"]);
});

test("createSharedViewConfig preserves an explicit duplicate name base and appends numeric suffixes on conflict", () => {
  const config = {
    version: 1,
    collections: {
      "data/runes.json:$": {
        defaultViewId: "all",
        views: [
          { ...allView, id: "all", name: "全部" },
          { ...allView, id: "damage", name: "构筑" },
          { ...allView, id: "damage-copy", name: "构筑 副本" },
        ],
      },
    },
  };

  const result = viewState.createSharedViewConfig(config, "data/runes.json:$", "damage", {
    ...allView,
    id: "damage",
    name: "构筑",
  }, {
    nameBase: "构筑 副本",
  });

  assert.equal(result.view.name, "构筑 副本 2");
});

test("deleteSharedViewConfig refuses last view and selects adjacent replacement", () => {
  assert.equal(typeof viewState.deleteSharedViewConfig, "function");
  const config = {
    version: 1,
    collections: {
      "data/runes.json:$": {
        defaultViewId: "all",
        views: [
          { ...allView, id: "all", name: "All" },
          { ...allView, id: "damage", name: "Damage" },
          { ...allView, id: "utility", name: "Utility" },
        ],
      },
    },
  };
  const draftState = {
    lastActiveViews: { "data/runes.json:$": "damage" },
    viewDrafts: {
      "data/runes.json:$": {
        damage: { query: "fire" },
        utility: { query: "support" },
      },
    },
    viewOrderDrafts: {
      "data/runes.json:$": ["utility", "damage", "all"],
    },
  };

  const result = viewState.deleteSharedViewConfig(config, draftState, "data/runes.json:$", "damage");

  assert.equal(result.deleted, true);
  assert.equal(result.nextActiveViewId, "utility");
  assert.deepEqual(result.config.collections["data/runes.json:$"].items.map((item) => item.view.id), ["all", "utility"]);
  assert.deepEqual(result.draftState, {
    lastActiveViews: { "data/runes.json:$": "utility" },
    structureDrafts: {},
    viewDrafts: {
      "data/runes.json:$": {
        utility: { query: "support" },
      },
    },
    viewOrderDrafts: {},
  });

  const single = {
    version: 1,
    collections: {
      "data/keywords.json:$": {
        defaultViewId: "all",
        views: [{ ...allView, id: "all" }],
      },
    },
  };
  assert.deepEqual(
    viewState.deleteSharedViewConfig(single, draftState, "data/keywords.json:$", "all"),
    {
      config: single,
      draftState,
      deleted: false,
      nextActiveViewId: "all",
    },
  );
});

test("deleteSharedViewConfig keeps current active view when deleting a different tab", () => {
  const config = {
    version: 1,
    collections: {
      "data/runes.json:$": {
        defaultViewId: "all",
        views: [
          { ...allView, id: "all", name: "All" },
          { ...allView, id: "damage", name: "Damage" },
          { ...allView, id: "utility", name: "Utility" },
        ],
      },
    },
  };
  const draftState = {
    lastActiveViews: { "data/runes.json:$": "all" },
    viewDrafts: {
      "data/runes.json:$": {
        damage: { query: "fire" },
      },
    },
    viewOrderDrafts: {},
  };

  const result = viewState.deleteSharedViewConfig(config, draftState, "data/runes.json:$", "damage");

  assert.equal(result.deleted, true);
  assert.equal(result.nextActiveViewId, "all");
  assert.deepEqual(result.config.collections["data/runes.json:$"].items.map((item) => item.view.id), ["all", "utility"]);
  assert.deepEqual(result.draftState, {
    lastActiveViews: { "data/runes.json:$": "all" },
    structureDrafts: {},
    viewDrafts: {},
    viewOrderDrafts: {},
  });
});

test("draftSharedViewOrder stores normalized order without saving shared config", () => {
  assert.equal(typeof viewState.draftSharedViewOrder, "function");
  const draftState = {
    lastActiveViews: {},
    viewDrafts: {},
    viewOrderDrafts: {},
  };
  const views = [
    { id: "all" },
    { id: "damage" },
    { id: "utility" },
  ];

  assert.deepEqual(viewState.draftSharedViewOrder(draftState, "data/runes.json:$", views, ["utility", "missing", "damage"]), {
    lastActiveViews: {},
    structureDrafts: {},
    viewDrafts: {},
    viewOrderDrafts: {
      "data/runes.json:$": ["utility", "damage", "all"],
    },
  });
});

test("saveSharedViewDraftsToConfig applies active draft and order draft then clears them", () => {
  assert.equal(typeof viewState.saveSharedViewDraftsToConfig, "function");
  const config = {
    version: 1,
    collections: {
      "data/runes.json:$": {
        defaultViewId: "all",
        views: [
          { ...allView, id: "all", name: "All" },
          { ...allView, id: "damage", name: "Damage", query: "base" },
          { ...allView, id: "utility", name: "Utility" },
        ],
      },
    },
  };
  const draftState = {
    lastActiveViews: { "data/runes.json:$": "damage" },
    viewDrafts: {
      "data/runes.json:$": {
        damage: { query: "fire", sorts: [{ id: "sort:power", field: "power", direction: "desc" }] },
      },
      "data/keywords.json:$": {
        all: { query: "shadow" },
      },
    },
    viewOrderDrafts: {
      "data/runes.json:$": ["utility", "damage", "all"],
      "data/keywords.json:$": ["all"],
    },
    structureDrafts: {
      "data/runes.json:$": {
        items: [{ kind: "group", groupId: "combat", name: "战斗", viewIds: ["utility", "damage"] }, { kind: "view", viewId: "all" }],
      },
    },
  };

  const result = viewState.saveSharedViewDraftsToConfig(config, draftState, "data/runes.json:$", "damage");

  assert.equal(result.config.collections["data/runes.json:$"].items[0].kind, "group");
  assert.deepEqual(result.config.collections["data/runes.json:$"].items[0].views.map((view) => [view.id, view.query]), [
    ["utility", ""],
    ["damage", "fire"],
  ]);
  assert.deepEqual(result.config.collections["data/runes.json:$"].items[0].views[1].sorts, [
    { id: "sort:power", field: "power", direction: "desc" },
  ]);
  assert.deepEqual(result.config.collections["data/runes.json:$"].items[1], { kind: "view", view: { ...allView, id: "all", name: "All" } });
  assert.deepEqual(result.draftState, {
    lastActiveViews: { "data/runes.json:$": "damage" },
    structureDrafts: {},
    viewDrafts: {
      "data/keywords.json:$": {
        all: { query: "shadow" },
      },
    },
    viewOrderDrafts: {
      "data/keywords.json:$": ["all"],
    },
  });
});

test("saveSharedViewDraftsToConfig only persists the explicit active shared view draft for the target collection", () => {
  const config = {
    version: 1,
    collections: {
      "data/runes.json:$": {
        defaultViewId: "all",
        views: [
          { ...allView, id: "all", name: "All" },
          { ...allView, id: "damage", name: "Damage", query: "base" },
          { ...allView, id: "utility", name: "Utility", query: "support" },
        ],
      },
    },
  };
  const draftState = {
    lastActiveViews: { "data/runes.json:$": "damage" },
    viewDrafts: {
      "data/runes.json:$": {
        damage: { query: "fire" },
        utility: { query: "shield" },
      },
    },
    viewOrderDrafts: {
      "data/runes.json:$": ["damage", "utility", "all"],
    },
  };

  const result = viewState.saveSharedViewDraftsToConfig(config, draftState, "data/runes.json:$", "damage");

  assert.deepEqual(result.config.collections["data/runes.json:$"].items.map((item) => [item.view.id, item.view.query]), [
    ["damage", "fire"],
    ["utility", "support"],
    ["all", ""],
  ]);
  assert.deepEqual(result.draftState, {
    lastActiveViews: { "data/runes.json:$": "damage" },
    structureDrafts: {},
    viewDrafts: {
      "data/runes.json:$": {
        utility: { query: "shield" },
      },
    },
    viewOrderDrafts: {},
  });
  assert.equal(result.dirty, true);
});

test("App dirty state treats structure drafts as shared view dirty", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(appSource, /draftSource\.viewOrderDrafts\?\.\[activeCollectionKey\]\?\.length/);
  assert.match(appSource, /draftSource\.structureDrafts\?\.\[activeCollectionKey\]\?\.items\?\.length/);
  assert.match(appSource, /setStatus\("已创建视图组"\)/);
  assert.match(appSource, /setStatus\("已在组内创建视图"\)/);
});

test("persistChanges and primary-key sync keep shared view drafts behind explicit save-for-everyone actions", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(appSource, /async function handleSaveViewForEveryone\(\)/);
  assert.doesNotMatch(appSource, /if \(viewDraftDirty\) await handleSaveViewForEveryone\(\);/);

  const primaryKeySyncSection = appSource.slice(
    appSource.indexOf("async function confirmPrimaryKeySyncSave()"),
    appSource.indexOf("async function handleCloseServer()"),
  );
  assert.ok(primaryKeySyncSection.includes("await flushPendingProfileSave();"));
  assert.ok(!primaryKeySyncSection.includes("setViewDraftDirty(false);"));
});

test("shared view reset uses draft-only reset instead of global view reset", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const resetSharedViewSection = appSource.slice(
    appSource.indexOf("function handleResetSharedViewDraft()"),
    appSource.indexOf("async function handleSaveViewForEveryone()"),
  );

  assert.match(resetSharedViewSection, /resetActiveSharedViewDraft/);
  assert.doesNotMatch(resetSharedViewSection, /handleResetView\(\)/);
  assert.doesNotMatch(resetSharedViewSection, /writeLocalViewState/);
  assert.doesNotMatch(resetSharedViewSection, /setSidebarWidth/);
});

test("global reset clears personal view layout without touching shared drafts", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const resetViewSection = appSource.slice(
    appSource.indexOf("function handleResetView()"),
    appSource.indexOf("function updateSharedViewDraftState"),
  );

  assert.match(resetViewSection, /resetViewLayoutState/);
  assert.match(resetViewSection, /writeLocalViewState/);
  assert.doesNotMatch(resetViewSection, /resetActiveSharedViewDraft/);
  assert.doesNotMatch(resetViewSection, /writeLocalSharedViewDrafts/);
});

test("deleting a shared view also clears the matching personal view layout state", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const deleteViewSection = appSource.slice(
    appSource.indexOf("async function handleDeleteSharedView"),
    appSource.indexOf("function handleReorderSharedViews"),
  );

  assert.match(deleteViewSection, /draft\.viewLayouts/);
  assert.match(deleteViewSection, /deleteLocalViewState/);
});

test("toolbar autosave state excludes shared view draft dirty while global unsaved state includes it", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const toolbarSection = appSource.slice(
    appSource.indexOf("<Toolbar"),
    appSource.indexOf("<div className=\"main-content\">"),
  );
  const hasUnsavedChangesSection = appSource.slice(
    appSource.indexOf("function hasUnsavedChanges()"),
    appSource.indexOf("async function confirmUnexpectedDisconnect"),
  );

  assert.match(appSource, /const toolbarDirty = dataDirty \|\| viewConfigDirty \|\| profileDirty;/);
  assert.match(appSource, /const globalDirty = toolbarDirty \|\| viewDraftDirty;/);
  assert.match(appSource, /const toolbarSnapshot = useMemo<ToolbarSnapshot>\(\(\) => \(\{/);
  assert.match(appSource, /autosaveState,/);
  assert.match(toolbarSection, /onResetView=\{handleResetView\}/);
  assert.doesNotMatch(toolbarSection, /dirty=\{toolbarDirty\}/);
  assert.doesNotMatch(toolbarSection, /onResetView=\{handleResetSharedViewDraft\}/);
  assert.match(hasUnsavedChangesSection, /viewDraftDirty/);
});

test("autosave architecture removes manual save entry points and old profile timer path", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const toolbarSource = await readFile(new URL("../src/components/Toolbar.tsx", import.meta.url), "utf8");

  assert.match(appSource, /save-coordinator/);
  assert.doesNotMatch(appSource, /async function handleSave\(\)/);
  assert.doesNotMatch(appSource, /async function saveViewConfigOnly\(/);
  assert.doesNotMatch(appSource, /profileSaveTimerRef/);
  assert.doesNotMatch(toolbarSource, /onSave:/);
  assert.doesNotMatch(toolbarSource, /className="primary-button"/);
  assert.doesNotMatch(toolbarSource, /保存中\.\.\." : "保存"/);
});

test("ViewTabs and App block shared view draft mutations while command saving", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const viewTabsSource = await readFile(new URL("../src/components/ViewTabs.tsx", import.meta.url), "utf8");

  for (const handlerName of [
    "handleSelectSharedView",
    "handleCreateSharedView",
    "handleDuplicateSharedView",
    "handleDuplicateSharedViewGroup",
    "handleRenameSharedView",
    "handleDeleteSharedView",
    "handleReorderSharedViews",
    "handleResetSharedViewDraft",
    "handleSaveViewForEveryone",
  ]) {
    const sectionStart = appSource.indexOf(`function ${handlerName}`);
    const asyncSectionStart = appSource.indexOf(`async function ${handlerName}`);
    const start = sectionStart >= 0 ? sectionStart : asyncSectionStart;
    assert.ok(start >= 0, `${handlerName} exists`);
    const endCandidates = [
      appSource.indexOf("\n  function ", start + 1),
      appSource.indexOf("\n  async function ", start + 1),
    ].filter((index) => index > start);
    const end = Math.min(...endCandidates);
    const section = appSource.slice(start, Number.isFinite(end) ? end : undefined);
    assert.match(section, /commandSaving/);
  }

  assert.match(viewTabsSource, /const viewTabsDisabled = commandSaving;/);
  assert.match(viewTabsSource, /Popover\.Root/);
  assert.match(viewTabsSource, /Popover\.Anchor/);
  assert.match(viewTabsSource, /if \(active\) \{\s*setOpenMenuViewId\(view\.id\);/);
  assert.doesNotMatch(viewTabsSource, /window\.prompt|prompt\(/);
  assert.match(viewTabsSource, /view-tab-rename-form/);
  assert.match(viewTabsSource, /onDuplicateView/);
  assert.match(viewTabsSource, /disabled=\{viewTabsDisabled\}/);
  assert.match(viewTabsSource, /if \(viewTabsDisabled\) return;/);

  const updateActiveViewDraftSection = appSource.slice(
    appSource.indexOf("function updateActiveViewDraft"),
    appSource.indexOf("function handleReorderFiles"),
  );
  assert.match(updateActiveViewDraftSection, /if \(commandSaving\) return;/);
});

test("stable text editing structure is wired", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const detailPanelSource = await readFile(new URL("../src/detail/DetailPanel.tsx", import.meta.url), "utf8");
  const cellRendererSource = await readFile(new URL("../src/table/CellRenderer.tsx", import.meta.url), "utf8");
  const dataTableSource = await readFile(new URL("../src/table/DataTable.tsx", import.meta.url), "utf8");
  const tableColumnsSource = await readFile(new URL("../src/table/table-columns.tsx", import.meta.url), "utf8");
  const textCellSurfaceSource = await readFile(new URL("../src/table/TextCellSurface.tsx", import.meta.url), "utf8");
  const backlinkCellViewerSource = await readFile(new URL("../src/table/BacklinkCellViewer.tsx", import.meta.url), "utf8");
  const viewTabsSource = await readFile(new URL("../src/components/ViewTabs.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(detailPanelSource, /key=\{`\$\{props\.fieldName\}:\$\{String\(props\.value \?\? ""\)\}`\}/);
  assert.match(detailPanelSource, /StableTextInput/);
  assert.match(detailPanelSource, /StableTextarea/);
  assert.match(detailPanelSource, /commandSaving: boolean/);

  assert.doesNotMatch(appSource, /const \[saving, setSaving\] = useState\(false\)/);
  assert.match(appSource, /const \[commandSaving, setCommandSaving\] = useState\(false\)/);
  assert.match(appSource, /activeTextEditorRef/);
  assert.match(appSource, /tableTextEditMode/);

  assert.match(dataTableSource, /textEditable: boolean/);
  assert.match(dataTableSource, /const \[activeTextCellId, setActiveTextCellId\] = useState<string \| null>\(null\);/);
  assert.match(dataTableSource, /previous\.textEditable === next\.textEditable/);
  assert.match(dataTableSource, /previous\.onRegisterActiveTextEditor === next\.onRegisterActiveTextEditor/);
  assert.match(tableColumnsSource, /textEditable=\{runtime\.textEditable\}/);
  assert.match(tableColumnsSource, /const textEditingActive = runtime\.activeTextCellId === cellId;/);
  assert.match(cellRendererSource, /TextCellSurface/);
  assert.match(cellRendererSource, /displayType === "Text"[\s\S]+textEditable/);
  const tableTextCellEditorSource = await readFile(new URL("../src/editing/TableTextCellEditor.tsx", import.meta.url), "utf8");
  const handleKeyDownSection = tableTextCellEditorSource.slice(
    tableTextCellEditorSource.indexOf("function handleKeyDown"),
    tableTextCellEditorSource.indexOf("useEffect(() => () =>"),
  );
  assert.match(textCellSurfaceSource, /data-cell-role="text-editor-overlay"/);
  assert.match(textCellSurfaceSource, /editable-active/);
  assert.match(textCellSurfaceSource, /onActivate\(cellId\)/);
  assert.doesNotMatch(textCellSurfaceSource, /title=\{textValue\}/);
  assert.doesNotMatch(cellRendererSource, /data-cell-role="content"[\s\S]+title=\{textValue\}/);
  assert.doesNotMatch(tableColumnsSource, /data-cell-role="title-action"[\s\S]+title=/);
  assert.doesNotMatch(backlinkCellViewerSource, /title=\{message\}|title=\{`\$\{item\.title\} \(\$\{item\.sourceFile\}\)`\}/);
  assert.match(backlinkCellViewerSource, /className=\{`multi-select-trigger backlink-trigger field-surface-table/);
  assert.match(backlinkCellViewerSource, /data-cell-role="token-trigger"/);
  assert.doesNotMatch(handleKeyDownSection, /event\.key === "Enter"[\s\S]+flushDraft\(\)/);
  assert.doesNotMatch(cellRendererSource.slice(cellRendererSource.indexOf('displayType === "Select"'), cellRendererSource.indexOf('displayType === "Relation"')), /textEditable/);
  assert.doesNotMatch(cellRendererSource.slice(cellRendererSource.indexOf('displayType === "Multi-select"'), cellRendererSource.indexOf('displayType === "Select"')), /textEditable/);
  assert.doesNotMatch(cellRendererSource.slice(cellRendererSource.indexOf('displayType === "Relation"'), cellRendererSource.indexOf("const textValue")), /textEditable/);

  assert.match(viewTabsSource, /tableTextEditMode/);
  assert.match(viewTabsSource, /onToggleTableTextEditMode/);
  assert.match(viewTabsSource, /title="编辑文本单元格"/);
  assert.match(viewTabsSource, /aria-pressed=\{tableTextEditMode\}/);
});

test("table cell frame structure is centralized in table-columns", async () => {
  const cellRendererSource = await readFile(new URL("../src/table/CellRenderer.tsx", import.meta.url), "utf8");
  const tableColumnsSource = await readFile(new URL("../src/table/table-columns.tsx", import.meta.url), "utf8");
  const tableCellFrameSource = await readFile(new URL("../src/table/TableCellFrame.tsx", import.meta.url), "utf8");

  assert.match(tableCellFrameSource, /export type TableCellContentKind/);
  assert.match(tableCellFrameSource, /export type TableCellLayout = "center" \| "top";/);
  assert.match(tableCellFrameSource, /className="table-cell-frame"/);
  assert.match(tableCellFrameSource, /data-cell-frame-kind/);
  assert.match(tableCellFrameSource, /data-cell-frame-layout/);
  assert.match(tableColumnsSource, /import \{ TableCellFrame, type TableCellContentKind, type TableCellLayout \} from "\.\/TableCellFrame"/);
  assert.match(tableColumnsSource, /tableLayoutMode: "center" \| "top";/);
  assert.match(tableColumnsSource, /function resolveCellFrameMeta/);
  assert.match(tableColumnsSource, /resolveCellFrameMeta\(columnModel, displayType, value, runtime\.tableLayoutMode, runtime\.textEditable, textEditingActive\)/);
  assert.match(tableColumnsSource, /if \(columnModel\.backlinkColumn\) \{[\s\S]+<TableCellFrame kind=\{frameMeta\.kind\} layout=\{frameMeta\.layout\}>/);
  assert.match(tableColumnsSource, /if \(columnModel\.isNested\) \{[\s\S]+<TableCellFrame kind=\{frameMeta\.kind\} layout=\{frameMeta\.layout\}>/);
  assert.match(tableColumnsSource, /if \(columnModel\.isTitle\) \{[\s\S]+<TableCellFrame kind=\{frameMeta\.kind\} layout=\{frameMeta\.layout\}>/);
  assert.match(tableColumnsSource, /return \([\s\S]+<TableCellFrame kind=\{frameMeta\.kind\} layout=\{frameMeta\.layout\}>[\s\S]+<CellRenderer/);
  assert.doesNotMatch(cellRendererSource, /TableCellFrame/);
});

test("backlink chip renderer keeps the wrapped multi-tag contract", async () => {
  const backlinkCellViewerSource = await readFile(new URL("../src/table/BacklinkCellViewer.tsx", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(backlinkCellViewerSource, /multi-select-trigger backlink-trigger/);
  assert.match(backlinkCellViewerSource, /data-wrap-mode=\{wrapped \? "wrap" : "truncate"\}/);
  assert.match(stylesSource, /\.backlink-chip-button\s*\{[\s\S]*flex-shrink:\s*0;/);
  assert.match(stylesSource, /\.backlink-chips-cell\s*\{[\s\S]*width:\s*100%;/);
});

test("add-filter field picker doubles its maximum height", async () => {
  const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(stylesSource, /\.add-filter-popover\s*\{[\s\S]*max-height:\s*680px;/);
});

test("filter condition trigger exposes a hover feedback state", async () => {
  const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(stylesSource, /\.filter-select-trigger:hover\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--color-bg-hover\) 78%, white 22%\);/);
});

test("duplicating a shared view copies the current user's personal layout and only drafts visible order when needed", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const duplicateSection = appSource.slice(
    appSource.indexOf("async function handleDuplicateSharedView"),
    appSource.indexOf("async function handleRenameSharedView"),
  );

  assert.match(duplicateSection, /copyViewLayoutState/);
  assert.match(duplicateSection, /nameBase: duplicateNameBase/);
  assert.match(duplicateSection, /insertViewIdAfter/);
  assert.match(duplicateSection, /if \(nextViewOrderDrafts\[activeCollectionKey\]\?\.length\)/);
  assert.doesNotMatch(duplicateSection, /\[result\.view\.id\]:/);
});

test("duplicating a shared view group clones the merged snapshot, drafts, and layouts before focusing the new group", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const duplicateSection = appSource.slice(
    appSource.indexOf("async function handleDuplicateSharedViewGroup"),
    appSource.indexOf("async function handleRenameSharedView"),
  );

  assert.match(duplicateSection, /resolvedCollectionViews\.topLevelItems/);
  assert.match(duplicateSection, /mergeSharedViewWithDraft/);
  assert.match(duplicateSection, /duplicateViewGroupConfig/);
  assert.match(duplicateSection, /sourceToTargetViewIdMap/);
  assert.match(duplicateSection, /duplicatedViewDraftsById/);
  assert.match(duplicateSection, /structuredClone\(sourceDraft\)/);
  assert.match(duplicateSection, /copyViewLayoutState/);
  assert.match(duplicateSection, /let nextProfile = draftProfile;/);
  assert.match(duplicateSection, /profile: nextProfile/);
  assert.match(duplicateSection, /expandedGroupId: result\.group\.id/);
  assert.match(duplicateSection, /setStatus\(layoutCopyFailed \? "视图组已复制，但部分布局复制失败" : "已复制视图组"\)/);
});

test("ViewTabs and ViewFilterBar expose shared view controls in the expected rows", async () => {
  const viewTabsSource = await readFile(new URL("../src/components/ViewTabs.tsx", import.meta.url), "utf8");
  const toolbarSource = await readFile(new URL("../src/components/Toolbar.tsx", import.meta.url), "utf8");
  const filterBarSource = await readFile(new URL("../src/components/ViewFilterBar.tsx", import.meta.url), "utf8");

  assert.match(viewTabsSource, /onToggleFilterBar/);
  assert.match(viewTabsSource, /onToggleTableTextEditMode/);
  assert.match(viewTabsSource, /onToggleRowDeleteControls/);
  assert.match(viewTabsSource, /onAddRow/);
  assert.match(viewTabsSource, /onManualSave/);
  assert.match(viewTabsSource, /onSaveDocumentRoot/);
  assert.match(viewTabsSource, /onRefreshDocumentIndex/);
  assert.match(viewTabsSource, /manualSaveDirty: boolean;/);
  assert.match(viewTabsSource, /hasActiveFilters/);
  assert.match(viewTabsSource, /rowDeleteControlsVisible/);
  assert.match(viewTabsSource, /aria-pressed=\{filterBarVisible\}/);
  assert.match(viewTabsSource, /aria-pressed=\{tableTextEditMode\}/);
  assert.match(viewTabsSource, /aria-expanded=\{settingsOpen\}/);
  assert.match(viewTabsSource, /view-tabs-filter-toggle/);
  assert.match(viewTabsSource, /view-tabs-table-edit-toggle/);
  assert.match(viewTabsSource, /hasActiveFilters \? "has-filters" : ""/);
  assert.match(viewTabsSource, /manualSaveDirty \? "has-unsaved" : ""/);
  assert.match(viewTabsSource, /filterBarVisible \? "visible" : ""/);
  assert.match(viewTabsSource, /view-tabs-row-delete-toggle/);
  assert.match(viewTabsSource, /settingsOpen \? "active" : ""/);
  assert.match(viewTabsSource, /table-settings-popover-shell/);
  assert.match(viewTabsSource, /<TableSettingsPopover/);
  assert.match(viewTabsSource, /<icons\.borderAll size=\{17\} \/>/);
  assert.match(viewTabsSource, /<icons\.addField size=\{18\} \/>/);
  assert.match(viewTabsSource, /<icons\.save size=\{18\} \/>/);
  assert.match(viewTabsSource, /<icons\.adjust size=\{18\} \/>/);
  assert.match(viewTabsSource, /<icons\.edit size=\{18\} \/>/);
  assert.match(viewTabsSource, /className="view-tab-action view-tabs-add-row primary"/);
  assert.match(viewTabsSource, /"view-tab-action view-tabs-manual-save",/);
  assert.match(viewTabsSource, /<span>新建<\/span>/);
  assert.match(viewTabsSource, /<span>保存<\/span>/);
  assert.match(viewTabsSource, /<span>编辑<\/span>/);
  assert.match(viewTabsSource, /<span>调整<\/span>/);
  assert.doesNotMatch(viewTabsSource, /<span>配置<\/span>/);
  assert.doesNotMatch(viewTabsSource, /view-tabs-search/);
  assert.doesNotMatch(viewTabsSource, /onSaveForEveryone/);
  assert.doesNotMatch(viewTabsSource, /onResetView/);
  assert.match(viewTabsSource, /创建视图副本/);
  assert.match(viewTabsSource, /拷贝视图链接/);
  assert.match(viewTabsSource, /view-tabs-top-level/);
  assert.match(viewTabsSource, /view-tabs-group-row/);
  assert.match(viewTabsSource, /group-tab-search/);
  assert.match(viewTabsSource, /view-tabs-group-tabs/);
  assert.match(viewTabsSource, /筛选当前组标签/);
  assert.match(viewTabsSource, /document\.querySelector<HTMLInputElement>\("\.search-box input"\)/);
  assert.match(viewTabsSource, /topLevelItems\.map/);
  assert.match(viewTabsSource, /filteredGroupViews\.map/);
  assert.match(viewTabsSource, /view-tab-create-top-level/);
  assert.match(viewTabsSource, /view-tab-create-in-group/);
  assert.match(viewTabsSource, /创建视图组/);
  assert.match(viewTabsSource, /onCreateTopLevelView/);
  assert.match(viewTabsSource, /onCreateViewGroup/);
  assert.match(viewTabsSource, /onCreateViewInGroup/);
  assert.match(viewTabsSource, /onRenameGroup/);
  assert.match(viewTabsSource, /onDuplicateGroup/);
  assert.match(viewTabsSource, /onDeleteGroup/);
  assert.match(viewTabsSource, /重命名组/);
  assert.match(viewTabsSource, /删除组/);
  assert.match(viewTabsSource, /在组内创建视图/);
  assert.match(viewTabsSource, /复制组/);
  assert.doesNotMatch(viewTabsSource, /className="search-box"/);

  assert.match(toolbarSource, /<ExpandableSearch className="search-box"/);
  assert.match(toolbarSource, /placeholder="搜索当前表格"/);
  const expandableSearchSource = await readFile(new URL("../src/components/ExpandableSearch.tsx", import.meta.url), "utf8");
  assert.match(expandableSearchSource, /className="expandable-search-clear"/);
  assert.match(expandableSearchSource, /aria-label="清空搜索"/);
  assert.match(expandableSearchSource, /<icons\.close size=\{16\} \/>/);
  assert.match(toolbarSource, /toolbar-profile-picker/);
  assert.match(toolbarSource, /toolbar-hidden-fields/);
  assert.match(toolbarSource, /const showHourglassIcon = snapshot\.autosaveState === "pending" \|\| snapshot\.autosaveState === "saving";/);
  assert.match(toolbarSource, /const AutosaveIcon = showHourglassIcon \? icons\.hourglassEmpty : icons\.dirty;/);
  assert.match(toolbarSource, /const autosaveIconClassName = snapshot\.autosaveState === "saving" \? "toolbar-status-icon spinning" : "toolbar-status-icon";/);
  assert.match(toolbarSource, /<AutosaveIcon size=\{14\} className=\{autosaveIconClassName\} \/>/);

  assert.match(filterBarSource, /onSaveForEveryone/);
  assert.match(filterBarSource, /onResetView/);
  assert.match(filterBarSource, /const showSharedViewActions = !commandSaving && \(dirty \|\| viewOrderDirty\);/);
  assert.match(filterBarSource, /view-filter-actions/);
  assert.match(filterBarSource, /为所有人保存/);
  assert.match(filterBarSource, /重置/);
});

test("DataTable no longer renders the bottom New row button", async () => {
  const tableSource = await readFile(new URL("../src/table/DataTable.tsx", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(tableSource, /onAddRow: \(\) => void;/);
  assert.doesNotMatch(tableSource, /New row/);
  assert.doesNotMatch(tableSource, /className="new-row-button"/);
  assert.match(stylesSource, /\.table-shell\s*\{[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\);/);
  assert.doesNotMatch(stylesSource, /\.table-shell\s*\{[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\)\s+40px;/);
});

test("App routes resolved shared view structure into ViewTabs snapshot and page context grouping", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const viewTabsSource = await readFile(new URL("../src/components/ViewTabs.tsx", import.meta.url), "utf8");

  assert.match(appSource, /resolveSharedViewStructure/);
  assert.match(appSource, /const resolvedCollectionViews = useMemo/);
  assert.match(appSource, /topLevelItems: resolvedCollectionViews\.topLevelItems,/);
  assert.match(appSource, /onAddRow=\{handleAddRow\}/);
  assert.match(appSource, /onManualSave=\{\(\) => void persistChanges\(\)\}/);
  assert.match(appSource, /manualSaveDirty: toolbarDirty,/);
  assert.match(appSource, /expandedGroupId: resolvedCollectionViews\.expandedGroupId,/);
  assert.match(appSource, /activeGroupId: resolvedCollectionViews\.activeGroupId,/);
  assert.match(appSource, /updatePageContextViewGrouping/);
  assert.match(appSource, /lastActiveViewIdByGroupId:/);
  assert.match(appSource, /onCreateTopLevelView=\{handleCreateTopLevelSharedView\}/);
  assert.match(appSource, /onCreateViewGroup=\{handleCreateSharedViewGroup\}/);
  assert.match(appSource, /onCreateViewInGroup=\{handleCreateSharedViewInGroup\}/);
  assert.match(appSource, /onRenameGroup=\{handleRenameSharedViewGroup\}/);
  assert.match(appSource, /onDuplicateGroup=\{handleDuplicateSharedViewGroup\}/);
  assert.match(appSource, /onDeleteGroup=\{handleDeleteSharedViewGroup\}/);

  assert.match(viewTabsSource, /topLevelItems:/);
  assert.match(viewTabsSource, /expandedGroupId:/);
  assert.match(viewTabsSource, /activeGroupId:/);
});

test("row delete controls stay hidden until the temporary toolbar mode is enabled", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const dataTableSource = await readFile(new URL("../src/table/DataTable.tsx", import.meta.url), "utf8");

  assert.match(appSource, /const \[rowDeleteControlsVisible, setRowDeleteControlsVisible\] = useState\(false\);/);
  assert.match(appSource, /rowDeleteControlsVisible,/);
  assert.match(appSource, /onToggleRowDeleteControls=\{\(\) => setRowDeleteControlsVisible\(\(value\) => !value\)\}/);
  assert.match(appSource, /onSaveDocumentRoot=\{handleSaveDocumentRoot\}/);
  assert.match(appSource, /onRefreshDocumentIndex=\{handleRefreshDocumentIndex\}/);
  assert.match(appSource, /documentConfiguredFields: configuredDocumentFields,/);
  assert.match(appSource, /onConfigureDocument=\{handleConfigureDocument\}/);
  assert.match(appSource, /onClearDocument=\{handleClearDocument\}/);
  assert.match(appSource, /showRowDeleteControls=\{rowDeleteControlsVisible\}/);
  assert.doesNotMatch(appSource, /localStorage\.(?:getItem|setItem)\([^)]*rowDeleteControlsVisible/);

  assert.match(dataTableSource, /showRowDeleteControls: boolean;/);
  assert.match(dataTableSource, /className=\{props\.showRowDeleteControls \? "icon-button danger" : "icon-button danger row-delete-hidden"\}/);
  assert.match(dataTableSource, /aria-hidden=\{!props\.showRowDeleteControls\}/);
  assert.match(dataTableSource, /tabIndex=\{props\.showRowDeleteControls \? 0 : -1\}/);
  assert.match(dataTableSource, /previous\.showRowDeleteControls === next\.showRowDeleteControls/);
});
