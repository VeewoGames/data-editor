import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyLocalViewState,
  emptyLocalSharedViewDrafts,
  emptyCollectionViewState,
  readLocalViewState,
  readLocalSharedViewDrafts,
  readCollectionViewState,
  readLocalFileOrder,
  resetCollectionViewState,
  writeLocalFileOrder,
  writeLocalSharedViewDrafts,
  writeLocalViewState,
} from "../src/view-state-storage.mjs";

test("profile mode ignores legacy localStorage width hidden and order fallback", () => {
  const localState = {
    widths: { description: 320 },
    hidden: ["description"],
    wrapped: ["description"],
    order: ["description", "rune_name"],
    detailOrder: ["description"],
    sidebarWidth: 444,
  };
  const profile = {
    sidebarWidth: 260,
    collections: {
      "data/runes.json:$": {
        hidden: [],
        wrapped: [],
        order: ["rune_name", "description"],
        detailOrder: ["rune_name", "description"],
        widths: { description: 180 },
      },
    },
  };

  const state = readCollectionViewState({
    mode: "profile",
    path: "data/runes.json",
    collectionPath: "$",
    localState,
    profile,
  });

  assert.deepEqual(state, {
    hidden: [],
    wrapped: [],
    order: ["rune_name", "description"],
    detailOrder: ["rune_name", "description"],
    widths: { description: 180 },
    sidebarWidth: 260,
  });
});

test("local mode reads only local state", () => {
  const state = readCollectionViewState({
    mode: "local",
    path: "data/runes.json",
    collectionPath: "$",
    localState: {
      widths: { description: 300 },
      hidden: ["description"],
      wrapped: [],
      order: ["description", "rune_name"],
      detailOrder: [],
      sidebarWidth: 350,
    },
    profile: null,
  });

  assert.equal(state.widths.description, 300);
  assert.deepEqual(state.hidden, ["description"]);
  assert.equal(state.sidebarWidth, 350);
});

test("profile reset removes only target collection and clears profile sidebar width", () => {
  const next = resetCollectionViewState({
    mode: "profile",
    path: "data/runes.json",
    collectionPath: "$",
    profile: {
      sidebarWidth: 320,
      fileOrder: ["data/status_effects.json", "data/runes.json"],
      collections: {
        "data/runes.json:$": {
          hidden: ["description"],
          wrapped: [],
          order: ["description"],
          detailOrder: [],
          widths: { description: 240 },
        },
        "data/status_effects.json:$": emptyCollectionViewState(),
      },
    },
    localState: null,
  });

  assert.equal(next.profile.collections["data/runes.json:$"], undefined);
  assert.ok(next.profile.collections["data/status_effects.json:$"]);
  assert.equal(next.profile.sidebarWidth, null);
  assert.deepEqual(next.profile.fileOrder, ["data/status_effects.json", "data/runes.json"]);
});

test("profile mode uses empty state when profile collection has no saved values", () => {
  const state = readCollectionViewState({
    mode: "profile",
    path: "data/runes.json",
    collectionPath: "$",
    localState: {
      widths: { description: 320 },
      hidden: ["description"],
      wrapped: ["description"],
      order: ["description"],
      detailOrder: ["description"],
      sidebarWidth: 400,
    },
    profile: {
      sidebarWidth: null,
      collections: {
        "data/runes.json:$": {
          hidden: [],
          wrapped: [],
          order: [],
          detailOrder: [],
          widths: {},
        },
      },
    },
  });

  assert.equal(state.widths.description, undefined);
  assert.deepEqual(state.hidden, []);
  assert.deepEqual(state.order, []);
  assert.equal(state.sidebarWidth, null);
});

test("readLocalViewState reads only localStorage keys for the current collection", () => {
  const storage = createMemoryStorage({
    "data-editor:data/runes.json:$:description:hidden": "1",
    "data-editor:data/runes.json:$:description:wrapped": "1",
    "data-editor:data/runes.json:$:description:width": "280",
    "data-editor:data/runes.json:$:__order": "description,rune_name",
    "data-editor:sidebar-width": "333",
    "data-editor:data/other.json:$:name:hidden": "1",
  });

  const state = readLocalViewState({
    path: "data/runes.json",
    collectionPath: "$",
    localStorage: storage,
  });

  assert.deepEqual(state.hidden, ["description"]);
  assert.deepEqual(state.wrapped, ["description"]);
  assert.deepEqual(state.order, ["description", "rune_name"]);
  assert.deepEqual(state.widths, { description: 280 });
  assert.equal(state.sidebarWidth, 333);
});

test("writeLocalViewState overwrites only localStorage keys for the current collection", () => {
  const storage = createMemoryStorage({
    "data-editor:data/runes.json:$:old:hidden": "1",
    "data-editor:data/runes.json:$:old:wrapped": "1",
    "data-editor:data/runes.json:$:old:width": "210",
    "data-editor:data/runes.json:$:__order": "old",
    "data-editor:sidebar-width": "300",
    "data-editor:data/other.json:$:name:hidden": "1",
  });

  writeLocalViewState({
    path: "data/runes.json",
    collectionPath: "$",
    state: {
      hidden: ["description"],
      wrapped: ["description"],
      order: ["rune_name", "description"],
      detailOrder: [],
      widths: { description: 180 },
      sidebarWidth: 260,
    },
    localStorage: storage,
  });

  assert.equal(storage.getItem("data-editor:data/runes.json:$:old:hidden"), null);
  assert.equal(storage.getItem("data-editor:data/runes.json:$:description:hidden"), "1");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:description:wrapped"), "1");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:description:width"), "180");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:__order"), "rune_name,description");
  assert.equal(storage.getItem("data-editor:sidebar-width"), "260");
  assert.equal(storage.getItem("data-editor:data/other.json:$:name:hidden"), "1");
});

test("readLocalFileOrder reads top-level file order independently of collection state", () => {
  const storage = createMemoryStorage({
    "data-editor:__file-order": "data/c.json,data/a.json",
    "data-editor:data/runes.json:$:__order": "description,rune_name",
  });

  assert.deepEqual(readLocalFileOrder(storage), ["data/c.json", "data/a.json"]);
});

test("writeLocalFileOrder stores top-level file order without touching collection state", () => {
  const storage = createMemoryStorage({
    "data-editor:__file-order": "data/old.json",
    "data-editor:data/runes.json:$:__order": "description,rune_name",
  });

  writeLocalFileOrder(storage, ["data/b.json", "data/a.json"]);

  assert.equal(storage.getItem("data-editor:__file-order"), "data/b.json,data/a.json");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:__order"), "description,rune_name");
});

test("writeLocalFileOrder removes top-level file order when empty", () => {
  const storage = createMemoryStorage({
    "data-editor:__file-order": "data/old.json",
  });

  writeLocalFileOrder(storage, []);

  assert.equal(storage.getItem("data-editor:__file-order"), null);
});

test("local shared view drafts are stored independently from collection view state", () => {
  const storage = createMemoryStorage({
    "data-editor:shared-view-drafts": JSON.stringify({
      lastActiveViews: {
        "data/runes.json:$": " view-1 ",
        "data/empty.json:$": "",
      },
      viewDrafts: {
        " data/runes.json:$ ": {
          " view-1 ": {
            id: "ignored-id",
            name: "Ignored",
            type: "table",
            query: " fire ",
            filters: {
              op: "or",
              rules: [
                { id: " rule-1 ", field: " element ", operator: "contains", value: "fire" },
              ],
            },
          },
        },
      },
      viewOrderDrafts: {
        " data/runes.json:$ ": [" view-2 ", "view-1", "view-2", " "],
      },
    }),
    "data-editor:data/runes.json:$:__order": "description,rune_name",
  });

  assert.deepEqual(readLocalSharedViewDrafts(storage), {
    lastActiveViews: {
      "data/runes.json:$": "view-1",
      },
      viewDrafts: {
        "data/runes.json:$": {
          "view-1": {
            query: "fire",
            filters: {
            op: "and",
            rules: [
              { id: "rule-1", field: "element", operator: "contains", value: "fire" },
            ],
          },
        },
      },
    },
    viewOrderDrafts: {
      "data/runes.json:$": ["view-2", "view-1"],
    },
  });

  writeLocalSharedViewDrafts(storage, {
    lastActiveViews: {
      " data/runes.json:$ ": " view-2 ",
    },
    viewDrafts: {
      " data/runes.json:$ ": {
        " view-2 ": {
          query: " ice ",
        },
      },
    },
    viewOrderDrafts: {
      " data/runes.json:$ ": ["view-2", "view-1", "view-2"],
    },
  });

  assert.deepEqual(JSON.parse(storage.getItem("data-editor:shared-view-drafts")), {
    lastActiveViews: {
      "data/runes.json:$": "view-2",
    },
    viewDrafts: {
      "data/runes.json:$": {
        "view-2": {
          query: "ice",
        },
      },
    },
    viewOrderDrafts: {
      "data/runes.json:$": ["view-2", "view-1"],
    },
  });
  assert.equal(storage.getItem("data-editor:data/runes.json:$:__order"), "description,rune_name");
});

test("writeLocalSharedViewDrafts removes storage when all shared drafts are empty", () => {
  const storage = createMemoryStorage({
    "data-editor:shared-view-drafts": JSON.stringify({ lastActiveViews: { "data/runes.json:$": "view-1" } }),
  });

  writeLocalSharedViewDrafts(storage, {
    lastActiveViews: {},
    viewDrafts: {
      "data/runes.json:$": {
        "view-1": {
          id: "ignored-id",
          name: "Ignored",
          type: "table",
        },
      },
    },
    viewOrderDrafts: {
      "data/runes.json:$": [],
    },
  });

  assert.equal(storage.getItem("data-editor:shared-view-drafts"), null);
});

test("local shared view drafts drop invalid non-empty draft fields", () => {
  const storage = createMemoryStorage();

  writeLocalSharedViewDrafts(storage, {
    viewDrafts: {
      "data/runes.json:$": {
        "view-1": {
          filters: {
            op: "or",
            rules: [
              { id: "bad", field: "element", operator: "starts_with" },
            ],
          },
          sorts: [
            { id: "bad", field: "power", direction: "down" },
          ],
          hidden: "icon",
          widths: { tiny: 0.4, bad: "88" },
        },
      },
    },
  });

  assert.equal(storage.getItem("data-editor:shared-view-drafts"), null);
});

test("readLocalSharedViewDrafts returns empty drafts for malformed JSON", () => {
  const storage = createMemoryStorage({
    "data-editor:shared-view-drafts": "{bad json",
  });

  assert.deepEqual(readLocalSharedViewDrafts(storage), emptyLocalSharedViewDrafts());
});

test("local reset returns an empty local view state", () => {
  const next = resetCollectionViewState({
    mode: "local",
    path: "data/runes.json",
    collectionPath: "$",
    profile: null,
    localState: {
      hidden: ["description"],
      wrapped: ["description"],
      order: ["description"],
      detailOrder: ["description"],
      widths: { description: 180 },
      sidebarWidth: 300,
    },
  });

  assert.deepEqual(next.localState, emptyLocalViewState());
});

function createMemoryStorage(seed = {}) {
  const state = new Map(Object.entries(seed));
  return {
    get length() {
      return state.size;
    },
    key(index) {
      return [...state.keys()][index] ?? null;
    },
    getItem(key) {
      return state.has(key) ? state.get(key) : null;
    },
    setItem(key, value) {
      state.set(key, String(value));
    },
    removeItem(key) {
      state.delete(key);
    },
  };
}
