import test from "node:test";
import assert from "node:assert/strict";
import {
  copyViewLayoutState,
  deleteLocalViewState,
  emptyLocalViewState,
  emptyLocalSharedViewDrafts,
  emptyViewLayoutState,
  mutateProfileViewLayoutState,
  readLocalViewState,
  readLocalSharedViewDrafts,
  readLocalSidebarTreePreferences,
  readViewLayoutState,
  readLocalFileOrder,
  resetViewLayoutState,
  writeLocalSidebarTreePreferences,
  writeLocalFileOrder,
  writeLocalSharedViewDrafts,
  writeLocalViewState,
} from "../src/view-state-storage.mjs";

test("profile mode reads detailOrder from the collection-global all layout", () => {
  const localState = {
    widths: { description: 320 },
    hidden: ["description"],
    wrapped: ["description"],
    order: ["description", "rune_name"],
    detailOrder: ["description"],
    sidebarWidth: 444,
    detailPanelWidth: 488,
    detailDocumentPanelOpen: true,
    detailDocumentPanelWidth: 352,
  };
  const profile = {
    sidebarWidth: 260,
    detailPanelWidth: 420,
    detailDocumentPanelOpen: false,
    detailDocumentPanelWidth: 376,
    viewLayouts: {
      "data/runes.json:$": {
        all: {
          hidden: [],
          wrapped: [],
          order: [],
          detailOrder: ["global_title", "global_description"],
          widths: {},
        },
        "view:damage/main": {
          hidden: [],
          wrapped: [],
          order: ["rune_name", "description"],
          detailOrder: ["rune_name", "description"],
          widths: { description: 180 },
        },
      },
    },
  };

  const state = readViewLayoutState({
    mode: "profile",
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "view:damage/main",
    localState,
    profile,
  });

  assert.deepEqual(state, {
    hidden: [],
    wrapped: [],
    order: ["rune_name", "description"],
    detailOrder: ["global_title", "global_description"],
    widths: { description: 180 },
    sidebarWidth: 260,
    detailPanelWidth: 420,
    detailDocumentPanelOpen: false,
    detailDocumentPanelWidth: 376,
  });
});

test("local mode reads only local state", () => {
  const state = readViewLayoutState({
    mode: "local",
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "view:damage/main",
    localState: {
      widths: { description: 300 },
      hidden: ["description"],
      wrapped: [],
      order: ["description", "rune_name"],
      detailOrder: [],
      sidebarWidth: 350,
      detailPanelWidth: 430,
      detailDocumentPanelOpen: true,
      detailDocumentPanelWidth: 360,
    },
    profile: null,
  });

  assert.equal(state.widths.description, 300);
  assert.deepEqual(state.hidden, ["description"]);
  assert.equal(state.sidebarWidth, 350);
  assert.equal(state.detailPanelWidth, 430);
  assert.equal(state.detailDocumentPanelOpen, true);
  assert.equal(state.detailDocumentPanelWidth, 360);
});

test("profile reset removes only target view layout and clears profile sidebar width", () => {
  const next = resetViewLayoutState({
    mode: "profile",
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "view:damage/main",
    profile: {
      sidebarWidth: 320,
      detailPanelWidth: 410,
      detailDocumentPanelOpen: true,
      detailDocumentPanelWidth: 372,
      fileOrder: ["data/status_effects.json", "data/runes.json"],
      lastActiveViews: {
        "data/runes.json:$": "damage",
      },
      viewLayouts: {
        "data/runes.json:$": {
          "view:damage/main": {
            hidden: ["description"],
            wrapped: [],
            order: ["description"],
            detailOrder: [],
            widths: { description: 240 },
          },
          utility: {
            hidden: ["rune_name"],
            wrapped: [],
            order: ["rune_name"],
            detailOrder: ["rune_name"],
            widths: { rune_name: 240 },
          },
        },
        "data/status_effects.json:$": {
          all: emptyViewLayoutState(),
        },
      },
      collections: {
        "data/runes.json:$": {
          hidden: ["description"],
          wrapped: [],
          order: ["description"],
          detailOrder: [],
          widths: { description: 240 },
        },
      },
    },
    localState: null,
  });

  assert.equal(next.profile.viewLayouts["data/runes.json:$"]["view:damage/main"], undefined);
  assert.ok(next.profile.viewLayouts["data/runes.json:$"].utility);
  assert.ok(next.profile.viewLayouts["data/status_effects.json:$"]);
  assert.equal(next.profile.collections["data/runes.json:$"], undefined);
  assert.equal(next.profile.sidebarWidth, null);
  assert.equal(next.profile.detailPanelWidth, null);
  assert.equal(next.profile.detailDocumentPanelOpen, null);
  assert.equal(next.profile.detailDocumentPanelWidth, null);
  assert.deepEqual(next.profile.fileOrder, ["data/status_effects.json", "data/runes.json"]);
});

test("profile mode uses empty state when profile collection has no saved values", () => {
  const state = readViewLayoutState({
    mode: "profile",
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "view:missing/main",
    localState: {
      widths: { description: 320 },
      hidden: ["description"],
      wrapped: ["description"],
      order: ["description"],
      detailOrder: ["description"],
      sidebarWidth: 400,
      detailPanelWidth: 490,
      detailDocumentPanelOpen: true,
      detailDocumentPanelWidth: 364,
    },
    profile: {
      sidebarWidth: null,
      detailPanelWidth: 405,
      detailDocumentPanelOpen: false,
      detailDocumentPanelWidth: 388,
      viewLayouts: {
        "data/runes.json:$": {
          all: {
            hidden: [],
            wrapped: [],
            order: [],
            detailOrder: [],
            widths: {},
          },
        },
      },
    },
  });

  assert.equal(state.widths.description, undefined);
  assert.deepEqual(state.hidden, []);
  assert.deepEqual(state.order, []);
  assert.equal(state.sidebarWidth, null);
  assert.equal(state.detailPanelWidth, 405);
  assert.equal(state.detailDocumentPanelOpen, false);
  assert.equal(state.detailDocumentPanelWidth, 388);
});

test("profile mode inherits all layout when active group view has no dedicated layout", () => {
  const state = readViewLayoutState({
    mode: "profile",
    path: "data/traits.json",
    collectionPath: "traits",
    viewId: "tag-mana",
    localState: emptyLocalViewState(),
    profile: {
      sidebarWidth: null,
      detailPanelWidth: 405,
      detailDocumentPanelOpen: false,
      detailDocumentPanelWidth: 388,
      viewLayouts: {
        "data/traits.json:traits": {
          all: {
            hidden: ["id"],
            wrapped: ["description"],
            order: ["use", "dev_status", "budget_left"],
            detailOrder: ["trait_name", "description"],
            widths: { use: 44, trait_name: 220 },
          },
        },
      },
    },
  });

  assert.deepEqual(state.hidden, ["id"]);
  assert.deepEqual(state.wrapped, ["description"]);
  assert.deepEqual(state.order, ["use", "dev_status", "budget_left"]);
  assert.deepEqual(state.detailOrder, ["trait_name", "description"]);
  assert.deepEqual(state.widths, { use: 44, trait_name: 220 });
});

test("profile mode merges sparse group view layout with all layout", () => {
  const state = readViewLayoutState({
    mode: "profile",
    path: "data/traits.json",
    collectionPath: "traits",
    viewId: "tag-evasion",
    localState: emptyLocalViewState(),
    profile: {
      sidebarWidth: null,
      detailPanelWidth: 405,
      detailDocumentPanelOpen: false,
      detailDocumentPanelWidth: 388,
      viewLayouts: {
        "data/traits.json:traits": {
          all: {
            hidden: ["id"],
            wrapped: ["description"],
            order: ["use", "dev_status", "budget_left"],
            detailOrder: ["trait_name", "description"],
            widths: { use: 44, trait_name: 220, description: 360 },
          },
          "tag-evasion": {
            hidden: [],
            wrapped: [],
            order: [],
            detailOrder: [],
            widths: { trait_name: 260 },
          },
        },
      },
    },
  });

  assert.deepEqual(state.hidden, ["id"]);
  assert.deepEqual(state.wrapped, ["description"]);
  assert.deepEqual(state.order, ["use", "dev_status", "budget_left"]);
  assert.deepEqual(state.detailOrder, ["trait_name", "description"]);
  assert.deepEqual(state.widths, { use: 44, trait_name: 260, description: 360 });
});

test("mutateProfileViewLayoutState preserves inherited wrapped fields when editing a specific view", () => {
  const profile = {
    sidebarWidth: null,
    detailPanelWidth: 405,
    detailDocumentPanelOpen: false,
    detailDocumentPanelWidth: 388,
    fileOrder: ["data/traits.json"],
    sidebarTree: { childOrderByParent: {}, expandedNodeIds: [] },
    lastActiveViews: { "data/traits.json:traits": "tag-evasion" },
    viewDrafts: {},
    viewOrderDrafts: {},
    viewLayouts: {
      "data/traits.json:traits": {
        all: {
          hidden: ["id"],
          wrapped: ["description"],
          order: ["use", "dev_status", "budget_left"],
          detailOrder: ["trait_name", "description"],
          widths: { use: 44, trait_name: 220, description: 360 },
        },
        "tag-evasion": {
          hidden: [],
          wrapped: [],
          order: [],
          detailOrder: [],
          widths: { trait_name: 260 },
        },
      },
    },
    collections: {
      "data/traits.json:traits": {
        hidden: ["id"],
        wrapped: ["description"],
        order: ["use", "dev_status", "budget_left"],
        detailOrder: ["trait_name", "description"],
        widths: { use: 44, trait_name: 260, description: 360 },
      },
    },
  };

  const nextProfile = mutateProfileViewLayoutState({
    profile,
    path: "data/traits.json",
    collectionPath: "traits",
    viewId: "tag-evasion",
    mutator: (draft) => {
      draft.wrapped = [...draft.wrapped, "notes"];
    },
  });

  assert.deepEqual(nextProfile.viewLayouts["data/traits.json:traits"]["tag-evasion"].wrapped, ["description", "notes"]);
  assert.deepEqual(nextProfile.collections["data/traits.json:traits"].wrapped, ["description", "notes"]);
  assert.deepEqual(readViewLayoutState({
    mode: "profile",
    path: "data/traits.json",
    collectionPath: "traits",
    viewId: "tag-evasion",
    localState: emptyLocalViewState(),
    profile: nextProfile,
  }).wrapped, ["description", "notes"]);
});

test("mutateProfileViewLayoutState can clear inherited wrapped fields in a specific view", () => {
  const profile = {
    sidebarWidth: null,
    detailPanelWidth: 405,
    detailDocumentPanelOpen: false,
    detailDocumentPanelWidth: 388,
    fileOrder: ["data/traits.json"],
    sidebarTree: { childOrderByParent: {}, expandedNodeIds: [] },
    lastActiveViews: { "data/traits.json:traits": "tag-evasion" },
    viewDrafts: {},
    viewOrderDrafts: {},
    viewLayouts: {
      "data/traits.json:traits": {
        all: {
          hidden: ["id"],
          wrapped: ["description"],
          order: ["use", "dev_status", "budget_left"],
          detailOrder: ["trait_name", "description"],
          widths: { use: 44, trait_name: 220, description: 360 },
        },
        "tag-evasion": {
          hidden: [],
          wrapped: [],
          order: [],
          detailOrder: [],
          widths: { trait_name: 260 },
        },
      },
    },
    collections: {
      "data/traits.json:traits": {
        hidden: ["id"],
        wrapped: ["description"],
        order: ["use", "dev_status", "budget_left"],
        detailOrder: ["trait_name", "description"],
        widths: { use: 44, trait_name: 260, description: 360 },
      },
    },
  };

  const nextProfile = mutateProfileViewLayoutState({
    profile,
    path: "data/traits.json",
    collectionPath: "traits",
    viewId: "tag-evasion",
    mutator: (draft) => {
      draft.wrapped = draft.wrapped.filter((field) => field !== "description");
    },
  });

  assert.deepEqual(nextProfile.viewLayouts["data/traits.json:traits"]["tag-evasion"].wrapped, []);
  assert.deepEqual(readViewLayoutState({
    mode: "profile",
    path: "data/traits.json",
    collectionPath: "traits",
    viewId: "tag-evasion",
    localState: emptyLocalViewState(),
    profile: nextProfile,
  }).wrapped, []);
});

test("mutateProfileViewLayoutState writes detailOrder into the collection-global all layout", () => {
  const nextProfile = mutateProfileViewLayoutState({
    profile: {
      sidebarWidth: null,
      detailPanelWidth: 405,
      detailDocumentPanelOpen: false,
      detailDocumentPanelWidth: 388,
      fileOrder: ["data/runes.json"],
      sidebarTree: { childOrderByParent: {}, expandedNodeIds: [] },
      lastActiveViews: { "data/runes.json:$": "damage" },
      viewDrafts: {},
      viewOrderDrafts: {},
      viewLayouts: {
        "data/runes.json:$": {
          all: {
            hidden: [],
            wrapped: [],
            order: [],
            detailOrder: ["title", "description"],
            widths: {},
          },
          damage: {
            hidden: ["debug"],
            wrapped: [],
            order: ["name"],
            detailOrder: ["old_view_specific_value"],
            widths: { name: 180 },
          },
        },
      },
      collections: {
        "data/runes.json:$": {
          hidden: ["debug"],
          wrapped: [],
          order: ["name"],
          detailOrder: ["title", "description"],
          widths: { name: 180 },
        },
      },
    },
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "damage",
    mutator: (draft) => {
      draft.detailOrder = ["rarity", "name"];
    },
  });

  assert.deepEqual(nextProfile.viewLayouts["data/runes.json:$"].all.detailOrder, ["rarity", "name"]);
  assert.deepEqual(nextProfile.viewLayouts["data/runes.json:$"].damage.detailOrder, ["old_view_specific_value"]);
  assert.deepEqual(nextProfile.collections["data/runes.json:$"].detailOrder, ["rarity", "name"]);
  assert.deepEqual(readViewLayoutState({
    mode: "profile",
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "damage",
    localState: emptyLocalViewState(),
    profile: nextProfile,
  }).detailOrder, ["rarity", "name"]);
});

test("mutateProfileViewLayoutState keeps the all view and legacy collection mirror in sync", () => {
  const nextProfile = mutateProfileViewLayoutState({
    profile: {
      sidebarWidth: null,
      detailPanelWidth: 405,
      detailDocumentPanelOpen: false,
      detailDocumentPanelWidth: 388,
      fileOrder: ["data/runes.json"],
      sidebarTree: { childOrderByParent: {}, expandedNodeIds: [] },
      lastActiveViews: { "data/runes.json:$": "all" },
      viewDrafts: {},
      viewOrderDrafts: {},
      viewLayouts: {
        "data/runes.json:$": {
          all: {
            hidden: [],
            wrapped: ["description"],
            order: [],
            detailOrder: [],
            widths: {},
          },
        },
      },
      collections: {
        "data/runes.json:$": {
          hidden: [],
          wrapped: ["description"],
          order: [],
          detailOrder: [],
          widths: {},
        },
      },
    },
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "all",
    mutator: (draft) => {
      draft.wrapped = [];
    },
  });

  assert.deepEqual(nextProfile.viewLayouts["data/runes.json:$"].all.wrapped, []);
  assert.deepEqual(nextProfile.collections["data/runes.json:$"].wrapped, []);
  assert.deepEqual(readViewLayoutState({
    mode: "profile",
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "all",
    localState: emptyLocalViewState(),
    profile: nextProfile,
  }).wrapped, []);
});

test("readLocalViewState reads detailOrder from the collection-global localStorage key", () => {
  const storage = createMemoryStorage({
    "data-editor:data/runes.json:$:view%3Adamage%2Fmain:description:hidden": "1",
    "data-editor:data/runes.json:$:view%3Adamage%2Fmain:description:wrapped": "1",
    "data-editor:data/runes.json:$:view%3Adamage%2Fmain:description:width": "280",
    "data-editor:data/runes.json:$:view%3Adamage%2Fmain:__order": "description,rune_name",
    "data-editor:data/runes.json:$:__detail-order": "description,rune_name",
    "data-editor:data/runes.json:$:view%3Adamage%2Fmain:__detail-order": "wrong,view,specific",
    "data-editor:sidebar-width": "333",
    "data-editor:detail-panel-width": "444",
    "data-editor:detail-document-panel-open": "1",
    "data-editor:detail-document-panel-width": "352",
    "data-editor:data/runes.json:$:damage:name:hidden": "1",
  });

  const state = readLocalViewState({
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "view:damage/main",
    localStorage: storage,
  });

  assert.deepEqual(state.hidden, ["description"]);
  assert.deepEqual(state.wrapped, ["description"]);
  assert.deepEqual(state.order, ["description", "rune_name"]);
  assert.deepEqual(state.detailOrder, ["description", "rune_name"]);
  assert.deepEqual(state.widths, { description: 280 });
  assert.equal(state.sidebarWidth, 333);
  assert.equal(state.detailPanelWidth, 444);
  assert.equal(state.detailDocumentPanelOpen, true);
  assert.equal(state.detailDocumentPanelWidth, 352);
});

test("writeLocalViewState stores detailOrder in the collection-global localStorage key", () => {
  const storage = createMemoryStorage({
    "data-editor:data/runes.json:$:view%3Adamage%2Fmain:old:hidden": "1",
    "data-editor:data/runes.json:$:view%3Adamage%2Fmain:old:wrapped": "1",
    "data-editor:data/runes.json:$:view%3Adamage%2Fmain:old:width": "210",
    "data-editor:data/runes.json:$:view%3Adamage%2Fmain:__order": "old",
    "data-editor:data/runes.json:$:view%3Adamage%2Fmain:__detail-order": "old",
    "data-editor:data/runes.json:$:__detail-order": "old-global",
    "data-editor:sidebar-width": "300",
    "data-editor:detail-panel-width": "450",
    "data-editor:detail-document-panel-open": "1",
    "data-editor:detail-document-panel-width": "344",
    "data-editor:data/runes.json:$:damage:name:hidden": "1",
  });

  writeLocalViewState({
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "view:damage/main",
    state: {
      hidden: ["description"],
      wrapped: ["description"],
      order: ["rune_name", "description"],
      detailOrder: ["description", "rune_name"],
      widths: { description: 180 },
      sidebarWidth: 260,
      detailPanelWidth: 410,
      detailDocumentPanelOpen: false,
      detailDocumentPanelWidth: 370,
    },
    localStorage: storage,
  });

  assert.equal(storage.getItem("data-editor:data/runes.json:$:view%3Adamage%2Fmain:old:hidden"), null);
  assert.equal(storage.getItem("data-editor:data/runes.json:$:view%3Adamage%2Fmain:description:hidden"), "1");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:view%3Adamage%2Fmain:description:wrapped"), "1");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:view%3Adamage%2Fmain:description:width"), "180");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:view%3Adamage%2Fmain:__order"), "rune_name,description");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:view%3Adamage%2Fmain:__detail-order"), null);
  assert.equal(storage.getItem("data-editor:data/runes.json:$:__detail-order"), "description,rune_name");
  assert.equal(storage.getItem("data-editor:sidebar-width"), "260");
  assert.equal(storage.getItem("data-editor:detail-panel-width"), "410");
  assert.equal(storage.getItem("data-editor:detail-document-panel-open"), "0");
  assert.equal(storage.getItem("data-editor:detail-document-panel-width"), "370");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:damage:name:hidden"), "1");
});

test("deleteLocalViewState removes only the targeted view layout keys", () => {
  const storage = createMemoryStorage({
    "data-editor:data/runes.json:$:view%3Adamage%2Fmain:description:hidden": "1",
    "data-editor:data/runes.json:$:all:description:hidden": "1",
    "data-editor:data/other.json:$:all:name:hidden": "1",
  });

  deleteLocalViewState({
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "view:damage/main",
    localStorage: storage,
  });

  assert.equal(storage.getItem("data-editor:data/runes.json:$:view%3Adamage%2Fmain:description:hidden"), null);
  assert.equal(storage.getItem("data-editor:data/runes.json:$:all:description:hidden"), "1");
  assert.equal(storage.getItem("data-editor:data/other.json:$:all:name:hidden"), "1");
});

test("copyViewLayoutState duplicates the source profile layout into the target view only when a source layout exists", () => {
  const result = copyViewLayoutState({
    mode: "profile",
    path: "data/runes.json",
    collectionPath: "$",
    sourceViewId: "all",
    targetViewId: "all-copy",
    profile: {
      sidebarWidth: 280,
      detailPanelWidth: 420,
      detailDocumentPanelOpen: true,
      detailDocumentPanelWidth: 368,
      fileOrder: ["data/runes.json"],
      lastActiveViews: { "data/runes.json:$": "all" },
      viewDrafts: {},
      viewOrderDrafts: {},
      viewLayouts: {
        "data/runes.json:$": {
          all: {
            hidden: ["description"],
            wrapped: ["description"],
            order: ["description", "rune_name"],
            detailOrder: ["description"],
            widths: { description: 260 },
          },
        },
      },
    },
    localStorage: null,
  });

  assert.equal(result.copied, true);
  assert.deepEqual(result.profile.viewLayouts["data/runes.json:$"]["all-copy"], {
    hidden: ["description"],
    wrapped: ["description"],
    order: ["description", "rune_name"],
    detailOrder: ["description"],
    widths: { description: 260 },
  });
  assert.deepEqual(result.profile.viewLayouts["data/runes.json:$"].all, {
    hidden: ["description"],
    wrapped: ["description"],
    order: ["description", "rune_name"],
    detailOrder: ["description"],
    widths: { description: 260 },
  });
});

test("copyViewLayoutState skips creating a target layout when the source profile view has no layout record", () => {
  const profile = {
    sidebarWidth: 280,
    detailPanelWidth: 420,
    fileOrder: ["data/runes.json"],
    lastActiveViews: { "data/runes.json:$": "all" },
    viewDrafts: {},
    viewOrderDrafts: {},
    viewLayouts: {
      "data/runes.json:$": {
        utility: emptyViewLayoutState(),
      },
    },
  };

  const result = copyViewLayoutState({
    mode: "profile",
    path: "data/runes.json",
    collectionPath: "$",
    sourceViewId: "all",
    targetViewId: "all-copy",
    profile,
    localStorage: null,
  });

  assert.equal(result.copied, false);
  assert.equal(result.profile, profile);
  assert.equal(result.profile.viewLayouts["data/runes.json:$"]["all-copy"], undefined);
});

test("copyViewLayoutState duplicates only the targeted local view layout keys", () => {
  const storage = createMemoryStorage({
    "data-editor:data/runes.json:$:all:description:hidden": "1",
    "data-editor:data/runes.json:$:all:description:wrapped": "1",
    "data-editor:data/runes.json:$:all:description:width": "220",
    "data-editor:data/runes.json:$:all:__order": "description,rune_name",
    "data-editor:data/runes.json:$:__detail-order": "description",
    "data-editor:data/runes.json:$:other:name:hidden": "1",
    "data-editor:sidebar-width": "300",
    "data-editor:detail-panel-width": "420",
    "data-editor:detail-document-panel-open": "1",
    "data-editor:detail-document-panel-width": "360",
  });

  const result = copyViewLayoutState({
    mode: "local",
    path: "data/runes.json",
    collectionPath: "$",
    sourceViewId: "all",
    targetViewId: "all-copy",
    profile: null,
    localStorage: storage,
  });

  assert.equal(result.copied, true);
  assert.equal(storage.getItem("data-editor:data/runes.json:$:all-copy:description:hidden"), "1");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:all-copy:description:wrapped"), "1");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:all-copy:description:width"), "220");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:all-copy:__order"), "description,rune_name");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:all-copy:__detail-order"), null);
  assert.equal(storage.getItem("data-editor:data/runes.json:$:__detail-order"), "description");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:other:name:hidden"), "1");
  assert.equal(storage.getItem("data-editor:sidebar-width"), "300");
  assert.equal(storage.getItem("data-editor:detail-panel-width"), "420");
  assert.equal(storage.getItem("data-editor:detail-document-panel-open"), "1");
  assert.equal(storage.getItem("data-editor:detail-document-panel-width"), "360");
});

test("copyViewLayoutState skips local target creation when the source view has no local layout keys", () => {
  const storage = createMemoryStorage({
    "data-editor:data/runes.json:$:other:name:hidden": "1",
    "data-editor:sidebar-width": "300",
  });

  const result = copyViewLayoutState({
    mode: "local",
    path: "data/runes.json",
    collectionPath: "$",
    sourceViewId: "all",
    targetViewId: "all-copy",
    profile: null,
    localStorage: storage,
  });

  assert.equal(result.copied, false);
  assert.equal(storage.getItem("data-editor:data/runes.json:$:all-copy:name:hidden"), null);
});

test("readLocalFileOrder reads top-level file order independently of collection state", () => {
  const storage = createMemoryStorage({
    "data-editor:__file-order": "data/c.json,data/a.json",
    "data-editor:data/runes.json:$:damage:__order": "description,rune_name",
  });

  assert.deepEqual(readLocalFileOrder(storage), ["data/c.json", "data/a.json"]);
});

test("writeLocalFileOrder stores top-level file order without touching collection state", () => {
  const storage = createMemoryStorage({
    "data-editor:__file-order": "data/old.json",
    "data-editor:data/runes.json:$:damage:__order": "description,rune_name",
  });

  writeLocalFileOrder(storage, ["data/b.json", "data/a.json"]);

  assert.equal(storage.getItem("data-editor:__file-order"), "data/b.json,data/a.json");
  assert.equal(storage.getItem("data-editor:data/runes.json:$:damage:__order"), "description,rune_name");
});

test("writeLocalFileOrder removes top-level file order when empty", () => {
  const storage = createMemoryStorage({
    "data-editor:__file-order": "data/old.json",
  });

  writeLocalFileOrder(storage, []);

  assert.equal(storage.getItem("data-editor:__file-order"), null);
});

test("readLocalSidebarTreePreferences reads top-level sidebar tree preferences independently from collection state", () => {
  const storage = createMemoryStorage({
    "data-editor:__sidebar-tree-prefs": JSON.stringify({
      childOrderByParent: { "source:data": ["folder:data/items", "folder:data/actors"] },
      expandedNodeIds: ["source:data", "folder:data/items"],
    }),
    "data-editor:data/runes.json:$:damage:__order": "description,rune_name",
  });

  assert.deepEqual(readLocalSidebarTreePreferences(storage), {
    childOrderByParent: { "source:data": ["folder:data/items", "folder:data/actors"] },
    expandedNodeIds: ["source:data", "folder:data/items"],
  });
});

test("writeLocalSidebarTreePreferences stores top-level sidebar tree preferences without touching collection state", () => {
  const storage = createMemoryStorage({
    "data-editor:__sidebar-tree-prefs": JSON.stringify({
      childOrderByParent: { "source:data": ["folder:data/actors"] },
      expandedNodeIds: ["folder:data/actors"],
    }),
    "data-editor:data/runes.json:$:damage:__order": "description,rune_name",
  });

  writeLocalSidebarTreePreferences(storage, {
    childOrderByParent: { "source:data": ["folder:data/items"] },
    expandedNodeIds: ["folder:data/items"],
  });

  assert.deepEqual(JSON.parse(storage.getItem("data-editor:__sidebar-tree-prefs")), {
    childOrderByParent: { "source:data": ["folder:data/items"] },
    expandedNodeIds: ["folder:data/items"],
  });
  assert.equal(storage.getItem("data-editor:data/runes.json:$:damage:__order"), "description,rune_name");
});

test("writeLocalSidebarTreePreferences removes storage when sidebar tree preferences are empty", () => {
  const storage = createMemoryStorage({
    "data-editor:__sidebar-tree-prefs": JSON.stringify({
      childOrderByParent: { "source:data": ["folder:data/actors"] },
      expandedNodeIds: ["folder:data/actors"],
    }),
  });

  writeLocalSidebarTreePreferences(storage, { childOrderByParent: {}, expandedNodeIds: [] });

  assert.equal(storage.getItem("data-editor:__sidebar-tree-prefs"), null);
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
    "data-editor:data/runes.json:$:damage:__order": "description,rune_name",
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
            topLevelRules: [
              { kind: "rule", id: "rule-1", field: "element", operator: "contains", value: "fire" },
            ],
            advancedRoot: null,
          },
        },
      },
    },
    viewOrderDrafts: {
      "data/runes.json:$": ["view-2", "view-1"],
    },
    structureDrafts: {},
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
    structureDrafts: {},
  });
  assert.equal(storage.getItem("data-editor:data/runes.json:$:damage:__order"), "description,rune_name");
});

test("readLocalSharedViewDrafts keeps shared view structure draft payload", () => {
  const storage = createMemoryStorage({
    "data-editor:shared-view-drafts": JSON.stringify({
      lastActiveViews: { "data/runes.json:$": "damage" },
      viewDrafts: {},
      viewOrderDrafts: {},
      structureDrafts: {
        "data/runes.json:$": {
          items: [{ kind: "group", groupId: "combat", name: "Combat", icon: "shield", viewIds: ["damage"] }],
        },
      },
    }),
  });

  assert.deepEqual(readLocalSharedViewDrafts(storage).structureDrafts, {
    "data/runes.json:$": {
      items: [{ kind: "group", groupId: "combat", name: "Combat", icon: "shield", viewIds: ["damage"] }],
    },
  });
});

test("writeLocalSharedViewDrafts keeps structure draft group icons", () => {
  const storage = createMemoryStorage();

  writeLocalSharedViewDrafts(storage, {
    lastActiveViews: { "data/runes.json:$": "damage" },
    viewDrafts: {},
    viewOrderDrafts: {},
    structureDrafts: {
      "data/runes.json:$": {
        items: [{ kind: "group", groupId: "combat", name: "Combat", icon: "shield", viewIds: ["damage"] }],
      },
    },
  });

  assert.deepEqual(JSON.parse(storage.getItem("data-editor:shared-view-drafts")), {
    lastActiveViews: { "data/runes.json:$": "damage" },
    viewDrafts: {},
    viewOrderDrafts: {},
    structureDrafts: {
      "data/runes.json:$": {
        items: [{ kind: "group", groupId: "combat", name: "Combat", icon: "shield", viewIds: ["damage"] }],
      },
    },
  });
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
  const next = resetViewLayoutState({
    mode: "local",
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "damage",
    profile: null,
    localState: {
      hidden: ["description"],
      wrapped: ["description"],
      order: ["description"],
      detailOrder: ["description"],
      widths: { description: 180 },
      sidebarWidth: 300,
      detailPanelWidth: 420,
      detailDocumentPanelOpen: false,
      detailDocumentPanelWidth: 372,
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
