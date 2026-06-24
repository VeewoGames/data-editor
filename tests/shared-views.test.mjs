import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  emptySharedViewsConfig,
  loadSharedViews,
  normalizeCollectionView,
  normalizeCollectionViewDraft,
  normalizeSharedViewDraftState,
  normalizeSharedViewsConfig,
  saveSharedViews,
} from "../src/shared-views.mjs";

test("loadSharedViews returns empty config when file is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-shared-views-"));
  try {
    assert.deepEqual(await loadSharedViews(root), emptySharedViewsConfig());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("normalizeSharedViewsConfig keeps valid views and cleans invalid rules sorts and values", () => {
  const config = normalizeSharedViewsConfig({
    version: 99,
    collections: {
      " data/runes.json:$ ": {
        defaultViewId: " damage ",
        views: [
          {
            id: " damage ",
            name: " Damage ",
            type: "board",
            query: " fire ",
            filters: {
              op: "or",
              rules: [
                { id: " r1 ", field: " element ", operator: "contains", value: "fire" },
                { id: "bad-op", field: "element", operator: "starts_with", value: "fire" },
                { id: "empty-field", field: " ", operator: "is" },
              ],
            },
            sorts: [
              { id: " s1 ", field: " power ", direction: "desc" },
              { id: "bad-dir", field: "rarity", direction: "down" },
              { id: "empty-field", field: " ", direction: "asc" },
            ],
            hidden: [" icon ", "", "icon", "tags"],
            wrapped: [" desc ", "desc"],
            order: [" power ", "name", "power"],
            detailOrder: [" notes ", "notes"],
            widths: { power: 120.6, tiny: 0.4, zero: 0, negative: -4, text: "88" },
          },
          null,
        ],
      },
      "bad-collection": null,
    },
  });

  assert.deepEqual(config, {
    version: 1,
    collections: {
      "data/runes.json:$": {
        defaultViewId: "damage",
        items: [
          {
            kind: "view",
            icon: "borderAll",
            view: {
              id: "damage",
              name: "Damage",
              type: "table",
              query: "fire",
              filters: {
                topLevelRules: [
                  { kind: "rule", id: "r1", field: "element", operator: "contains", value: "fire" },
                ],
                advancedRoot: null,
              },
              sorts: [
                { id: "s1", field: "power", direction: "desc" },
              ],
              hidden: ["icon", "tags"],
              wrapped: ["desc"],
              order: ["power", "name"],
              detailOrder: ["notes"],
              widths: { power: 121 },
            },
          },
        ],
      },
    },
  });
});

test("normalizeCollectionView fills missing fields with defaults", () => {
  assert.deepEqual(normalizeCollectionView({}), {
    id: "",
    name: "",
    type: "table",
    query: "",
    filters: { topLevelRules: [], advancedRoot: null },
    sorts: [],
    hidden: [],
    wrapped: [],
    order: [],
    detailOrder: [],
    widths: {},
  });
});

test("normalizeCollectionViewDraft only keeps draft override fields", () => {
  assert.deepEqual(normalizeCollectionViewDraft({
    id: "damage",
    name: "Damage",
    type: "table",
    query: " fire ",
    filters: {
      topLevelRules: [{ kind: "rule", id: "r1", field: "element", operator: "is", value: "fire" }],
      advancedRoot: null,
    },
    sorts: [{ id: "s1", field: "power", direction: "asc" }],
    hidden: [" icon ", "icon"],
    wrapped: [" desc "],
    order: ["power"],
    detailOrder: ["notes"],
    widths: { power: 99.4 },
  }), {
    query: "fire",
    filters: {
      topLevelRules: [{ kind: "rule", id: "r1", field: "element", operator: "is", value: "fire" }],
      advancedRoot: null,
    },
    sorts: [{ id: "s1", field: "power", direction: "asc" }],
    hidden: ["icon"],
    wrapped: ["desc"],
    order: ["power"],
    detailOrder: ["notes"],
    widths: { power: 99 },
  });
});

test("normalizeCollectionViewDraft keeps query-only draft partial", () => {
  assert.deepEqual(normalizeCollectionViewDraft({ query: " fire " }), {
    query: "fire",
  });
});

test("normalizeCollectionViewDraft keeps explicit empty filters override", () => {
  assert.deepEqual(normalizeCollectionViewDraft({
    filters: {
      topLevelRules: [],
      advancedRoot: null,
    },
  }), {
    filters: {
      topLevelRules: [],
      advancedRoot: null,
    },
  });
});

test("normalizeCollectionViewDraft omits invalid or missing optional draft fields", () => {
  assert.deepEqual(normalizeCollectionViewDraft({
    filters: { op: "or", rules: [{ id: "bad", field: "element", operator: "starts_with" }] },
    sorts: [{ id: "bad", field: "power", direction: "down" }],
    hidden: "icon",
    wrapped: null,
    order: [""],
    detailOrder: [null],
    widths: { tiny: 0.4, bad: "88" },
  }), {});
});

test("normalizeCollectionViewDraft excludes identity fields", () => {
  assert.deepEqual(normalizeCollectionViewDraft({
    id: "damage",
    name: "Damage",
    type: "table",
    query: "fire",
  }), {
    query: "fire",
  });
});

test("normalizeSharedViewDraftState trims collection and view keys consistently", () => {
  assert.deepEqual(normalizeSharedViewDraftState({
    lastActiveViews: {
      " data/runes.json:$ ": " view-1 ",
      " data/empty.json:$ ": "",
      " ": "view-ignored",
    },
    viewDrafts: {
      " data/runes.json:$ ": {
        " view-1 ": {
          query: " fire ",
        },
        " ": {
          query: "ignored",
        },
      },
      " data/empty.json:$ ": {
        empty: {
          id: "ignored-id",
          name: "Ignored",
          type: "table",
        },
      },
    },
    viewOrderDrafts: {
      " data/runes.json:$ ": [" view-2 ", "view-1", "view-2", " "],
      " data/empty.json:$ ": [" "],
    },
  }), {
    lastActiveViews: {
      "data/runes.json:$": "view-1",
    },
    viewDrafts: {
      "data/runes.json:$": {
        "view-1": {
          query: "fire",
        },
      },
    },
    viewOrderDrafts: {
      "data/runes.json:$": ["view-2", "view-1"],
    },
    structureDrafts: {},
  });
});

test("saveSharedViews writes normalized shared views file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-shared-views-"));
  try {
    const result = await saveSharedViews(root, {
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          views: [
            {
              id: " all ",
              name: " All ",
              query: " ",
              filters: { topLevelRules: [], advancedRoot: null },
              sorts: [{ id: "sort-name", field: "name", direction: "asc" }],
              hidden: [" internal_id "],
              wrapped: [],
              order: ["name"],
              detailOrder: [],
              widths: { name: 180.2 },
            },
          ],
        },
      },
    });

    assert.equal(result.path, ".data-editor/shared-views.json");
    const stored = JSON.parse(await readFile(path.join(root, result.path), "utf8"));
    assert.deepEqual(stored, {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          items: [
            {
              kind: "view",
              icon: "borderAll",
              view: {
                id: "all",
                name: "All",
                type: "table",
                query: "",
                filters: { topLevelRules: [], advancedRoot: null },
                sorts: [{ id: "sort-name", field: "name", direction: "asc" }],
                hidden: ["internal_id"],
                wrapped: [],
                order: ["name"],
                detailOrder: [],
                widths: { name: 180 },
              },
            },
          ],
        },
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saveSharedViews writes grouped items to disk", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-shared-views-"));
  try {
    await saveSharedViews(root, {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "damage",
          items: [{
            kind: "group",
            id: "combat",
            name: "Combat",
            views: [{
              id: "damage",
              name: "Damage",
              type: "table",
              query: "",
              filters: { topLevelRules: [], advancedRoot: null },
              sorts: [],
              hidden: [],
              wrapped: [],
              order: [],
              detailOrder: [],
              widths: {},
            }],
          }],
        },
      },
    });

    const stored = JSON.parse(await readFile(path.join(root, ".data-editor/shared-views.json"), "utf8"));
    assert.equal(Array.isArray(stored.collections["data/runes.json:$"].items), true);
    assert.equal(Object.hasOwn(stored.collections["data/runes.json:$"], "views"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saveSharedViews and loadSharedViews preserve generated core-solid icons", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-shared-views-"));
  try {
    await saveSharedViews(root, {
      version: 1,
      collections: {
        "data/runes.json:$": {
          defaultViewId: "all",
          items: [{
            kind: "view",
            icon: "streamlineCoreSolidApplyToAll",
            view: {
              id: "all",
              name: "All",
              type: "table",
              query: "",
              filters: { topLevelRules: [], advancedRoot: null },
              sorts: [],
              hidden: [],
              wrapped: [],
              order: [],
              detailOrder: [],
              widths: {},
            },
          }],
        },
      },
    });

    const loaded = await loadSharedViews(root);
    assert.equal(loaded.collections["data/runes.json:$"].items[0].icon, "streamlineCoreSolidApplyToAll");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Nocturnel trait tradeoff group keeps tag OR semantics and adds tradeoff filter to every tab", async () => {
  const configPath = "C:/Code/Nocturnel/.data-editor/shared-views.json";
  const config = normalizeSharedViewsConfig(JSON.parse(await readFile(configPath, "utf8")));
  const tradeoffGroup = config.collections["data/traits.json:traits"]?.items?.find((item) => item.kind === "group" && item.name === "代价");

  assert.ok(tradeoffGroup);
  assert.equal(tradeoffGroup.kind, "group");

  for (const item of tradeoffGroup.views) {
    assert.equal(item.kind, "view");
    const advancedRoot = item.view.filters.advancedRoot;
    assert.ok(advancedRoot, `${item.view.name} 缺少 advancedRoot`);
    assert.equal(advancedRoot.op, "and", `${item.view.name} 应使用顶层 AND`);
    assert.equal(advancedRoot.children.length, 2, `${item.view.name} 应只有 tags 组和 tradeoff 规则`);

    const [tagsGroup, tradeoffRule] = advancedRoot.children;
    assert.equal(tagsGroup.kind, "group", `${item.view.name} 的第一个 child 应为 tags 分组`);
    assert.equal(tagsGroup.op, "or", `${item.view.name} 的 tags 分组应保持 OR`);
    assert.deepEqual(
      tagsGroup.children.map((child) => child.field),
      ["input_tags", "output_tags"],
      `${item.view.name} 的 tags 分组应匹配 input_tags/output_tags`,
    );

    assert.equal(tradeoffRule.kind, "rule", `${item.view.name} 的第二个 child 应为 tradeoff 规则`);
    assert.equal(tradeoffRule.field, "type", `${item.view.name} 的 tradeoff 规则字段应为 type`);
    assert.equal(tradeoffRule.operator, "contains", `${item.view.name} 的 tradeoff 规则操作应为 contains`);
    assert.deepEqual(tradeoffRule.value, ["tradeoff"], `${item.view.name} 缺少 tradeoff 条件`);
  }
});
