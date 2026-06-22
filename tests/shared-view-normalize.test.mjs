import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeCollectionViewDraft,
  normalizeSharedViewsConfig,
  normalizeSharedViewDraftState,
} from "../src/view/shared-view-normalize.mjs";

test("shared view normalize module is browser-safe and keeps draft semantics", async () => {
  const source = await readFile(new URL("../src/view/shared-view-normalize.mjs", import.meta.url), "utf8");

  assert.equal(source.includes("node:fs"), false);
  assert.equal(source.includes("node:path"), false);
  assert.equal(source.includes("project-context"), false);
  assert.deepEqual(normalizeCollectionViewDraft({
    filters: { op: "or", rules: [{ id: "bad", field: "element", operator: "starts_with" }] },
    sorts: [{ id: "bad", field: "power", direction: "down" }],
    hidden: "icon",
    widths: { tiny: 0.4, bad: "88" },
  }), {});
  assert.deepEqual(normalizeSharedViewDraftState({
    viewDrafts: {
      " data/runes.json:$ ": {
        " view-1 ": {
          query: " fire ",
        },
      },
    },
  }).viewDrafts, {
    "data/runes.json:$": {
      "view-1": {
        query: "fire",
      },
    },
  });
});

test("normalizeSharedViewsConfig upgrades legacy flat filters into topLevelRules", () => {
  const config = normalizeSharedViewsConfig({
    version: 1,
    collections: {
      "data/runes.json:$": {
        defaultViewId: "all",
        views: [{
          id: "all",
          name: "全部",
          type: "table",
          query: "",
          filters: {
            op: "and",
            rules: [{ id: "filter:owner", field: "owner", operator: "is", value: "player" }],
          },
          sorts: [],
          hidden: [],
          wrapped: [],
          order: [],
          detailOrder: [],
          widths: {},
        }],
      },
    },
  });

  assert.deepEqual(config.collections["data/runes.json:$"].items[0].view.filters, {
    topLevelRules: [{ kind: "rule", id: "filter:owner", field: "owner", operator: "is", value: "player" }],
    advancedRoot: null,
  });
});

test("normalizeSharedViewsConfig upgrades legacy flat views into top-level items", () => {
  const config = normalizeSharedViewsConfig({
    version: 1,
    collections: {
      "data/runes.json:$": {
        defaultViewId: "all",
        views: [{
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
        }],
      },
    },
  });

  assert.deepEqual(config.collections["data/runes.json:$"].items, [{
    kind: "view",
    icon: "borderAll",
    view: {
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
    },
  }]);
});

test("normalizeSharedViewsConfig keeps group items and removes empty groups", () => {
  const config = normalizeSharedViewsConfig({
    version: 1,
    collections: {
      "data/runes.json:$": {
        defaultViewId: "damage",
        items: [
          {
            kind: "group",
            id: " combat ",
            name: " Combat ",
            views: [{
              id: " damage ",
              name: " Damage ",
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
          },
          {
            kind: "group",
            id: " empty ",
            name: " Empty ",
            views: [],
          },
        ],
      },
    },
  });

  assert.deepEqual(config.collections["data/runes.json:$"].items, [{
    kind: "group",
    id: "combat",
    name: "Combat",
    views: [{
      kind: "view",
      icon: "borderAll",
      view: {
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
      },
    }],
  }]);
});

test("normalizeSharedViewsConfig keeps valid icon and falls back on invalid icon", () => {
  const config = normalizeSharedViewsConfig({
    version: 1,
    collections: {
      "data/runes.json:$": {
        defaultViewId: "all",
        items: [
          {
            kind: "view",
            icon: "json",
            view: {
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
            },
          },
          {
            kind: "view",
            icon: "not-real",
            view: {
              id: "damage",
              name: "伤害",
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
          },
        ],
      },
    },
  });

  assert.equal(config.collections["data/runes.json:$"].items[0].icon, "json");
  assert.equal(config.collections["data/runes.json:$"].items[1].icon, "borderAll");
});

test("normalizeCollectionViewDraft does not keep icon", () => {
  assert.deepEqual(normalizeCollectionViewDraft({
    icon: "edit",
    query: "fire",
  }), {
    query: "fire",
  });
});

test("normalizeSharedViewsConfig upgrades group child views into leaf items with icon slots", () => {
  const config = normalizeSharedViewsConfig({
    version: 1,
    collections: {
      "data/runes.json:$": {
        defaultViewId: "damage",
        items: [{
          kind: "group",
          id: "combat",
          name: "战斗",
          views: [
            {
              id: "damage",
              name: "伤害",
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
          ],
        }],
      },
    },
  });

  assert.deepEqual(config.collections["data/runes.json:$"].items[0].views[0], {
    kind: "view",
    icon: "borderAll",
    view: {
      id: "damage",
      name: "伤害",
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
  });
});

test("normalizeSharedViewsConfig keeps legacy group child leaf items that still store fields at the top level", () => {
  const config = normalizeSharedViewsConfig({
    version: 1,
    collections: {
      "data/runes.json:$": {
        defaultViewId: "damage",
        items: [{
          kind: "group",
          id: "combat",
          name: "战斗",
          views: [
            {
              kind: "view",
              icon: "shield",
              id: "damage",
              name: "伤害",
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
          ],
        }],
      },
    },
  });

  assert.deepEqual(config.collections["data/runes.json:$"].items[0].views[0], {
    kind: "view",
    icon: "shield",
    view: {
      id: "damage",
      name: "伤害",
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
  });
});
