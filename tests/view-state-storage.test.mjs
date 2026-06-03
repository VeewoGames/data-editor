import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyLocalViewState,
  emptyCollectionViewState,
  readLocalViewState,
  readCollectionViewState,
  resetCollectionViewState,
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
