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
        views: [
          {
            id: "damage",
            name: "Damage",
            type: "table",
            query: "fire",
            filters: {
              op: "and",
              rules: [
                { id: "r1", field: "element", operator: "contains", value: "fire" },
              ],
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
    filters: { op: "and", rules: [] },
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
    filters: { op: "and", rules: [{ id: "r1", field: "element", operator: "is", value: "fire" }] },
    sorts: [{ id: "s1", field: "power", direction: "asc" }],
    hidden: [" icon ", "icon"],
    wrapped: [" desc "],
    order: ["power"],
    detailOrder: ["notes"],
    widths: { power: 99.4 },
  }), {
    query: "fire",
    filters: { op: "and", rules: [{ id: "r1", field: "element", operator: "is", value: "fire" }] },
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
              filters: { op: "and", rules: [] },
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
          views: [
            {
              id: "all",
              name: "All",
              type: "table",
              query: "",
              filters: { op: "and", rules: [] },
              sorts: [{ id: "sort-name", field: "name", direction: "asc" }],
              hidden: ["internal_id"],
              wrapped: [],
              order: ["name"],
              detailOrder: [],
              widths: { name: 180 },
            },
          ],
        },
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
