import test from "node:test";
import assert from "node:assert/strict";
import {
  buildViewContextKey,
  buildScrollContextKey,
  emptyPageContextState,
  readPageContextState,
  readProjectPageContext,
  updatePageContextQuery,
  updatePageContextScroll,
  updatePageContextSelection,
  updatePageContextViewGrouping,
  writePageContextState,
} from "../src/page-context-storage.ts";

test("readPageContextState normalizes malformed persisted state", () => {
  const storage = createMemoryStorage({
    "data-editor:page-context": JSON.stringify({
      projects: {
        "": {
          selectedPath: "data/ignored.json",
          collectionPath: "$",
          scrollByView: {
            "data/ignored.json:$:main": {
              scrollTop: 10,
              scrollLeft: 20,
            },
          },
        },
        alpha: {
          selectedPath: 42,
          collectionPath: "",
          scrollByView: {
            "data/runes.json:$:main": {
              scrollTop: 30,
              scrollLeft: 40,
            },
            "data/runes.json:$:bad": {
              scrollTop: -1,
              scrollLeft: Infinity,
            },
          },
        },
        beta: {
          selectedPath: "data/status_effects.json",
          collectionPath: "  $.effects  ",
          scrollByView: {
            "data/status_effects.json:$.effects:list": {
              scrollTop: "bad",
              scrollLeft: 12,
            },
          },
        },
      },
    }),
  });

  assert.deepEqual(readPageContextState(storage), {
    projects: {
      alpha: {
        selectedPath: null,
        collectionPath: "$",
        scrollByView: {
          "data/runes.json:$:main": {
            scrollTop: 30,
            scrollLeft: 40,
          },
        },
        queryByView: {},
        expandedGroupId: null,
        lastActiveViewIdByGroupId: {},
      },
      beta: {
        selectedPath: "data/status_effects.json",
        collectionPath: "$.effects",
        scrollByView: {},
        queryByView: {},
        expandedGroupId: null,
        lastActiveViewIdByGroupId: {},
      },
    },
  });
});

test("readPageContextState returns empty state for invalid JSON", () => {
  const storage = createMemoryStorage({
    "data-editor:page-context": "{bad json",
  });

  assert.deepEqual(readPageContextState(storage), emptyPageContextState());
});

test("writePageContextState persists only normalized project buckets", () => {
  const storage = createMemoryStorage();

  writePageContextState(storage, {
    projects: {
      alpha: {
        selectedPath: "data/runes.json",
        collectionPath: "",
        scrollByView: {
          "data/runes.json:$:main": {
            scrollTop: 12.2,
            scrollLeft: 8,
          },
        },
        queryByView: {},
      },
      "   ": {
        selectedPath: "data/ignored.json",
        collectionPath: "$",
        scrollByView: {},
      },
    },
  });

  assert.deepEqual(JSON.parse(storage.getItem("data-editor:page-context")), {
    projects: {
      alpha: {
        selectedPath: "data/runes.json",
        collectionPath: "$",
        scrollByView: {
          "data/runes.json:$:main": {
            scrollTop: 12.2,
            scrollLeft: 8,
          },
        },
        queryByView: {},
        expandedGroupId: null,
        lastActiveViewIdByGroupId: {},
      },
    },
  });
});

test("writePageContextState removes storage when normalized projects are empty", () => {
  const storage = createMemoryStorage({
    "data-editor:page-context": JSON.stringify({
      projects: {
        alpha: {
          selectedPath: "data/old.json",
          collectionPath: "$",
          scrollByView: {},
        },
      },
    }),
  });

  writePageContextState(storage, {
    projects: {
      "   ": {
        selectedPath: "data/ignored.json",
        collectionPath: "$",
        scrollByView: {},
      },
    },
  });

  assert.equal(storage.getItem("data-editor:page-context"), null);
});

test("readProjectPageContext returns empty project context for missing or invalid project ids", () => {
  const state = {
    projects: {
      alpha: {
        selectedPath: "data/runes.json",
        collectionPath: "$",
        scrollByView: {
          "data/runes.json:$:main": {
            scrollTop: 24,
            scrollLeft: 16,
          },
        },
        queryByView: {},
        expandedGroupId: null,
        lastActiveViewIdByGroupId: {},
      },
    },
  };

  assert.deepEqual(readProjectPageContext(state, "alpha"), state.projects.alpha);
  assert.deepEqual(readProjectPageContext(state, ""), {
    selectedPath: null,
    collectionPath: "$",
    scrollByView: {},
    queryByView: {},
    expandedGroupId: null,
    lastActiveViewIdByGroupId: {},
  });
  assert.deepEqual(readProjectPageContext(state, "missing"), {
    selectedPath: null,
    collectionPath: "$",
    scrollByView: {},
    queryByView: {},
    expandedGroupId: null,
    lastActiveViewIdByGroupId: {},
  });
});

test("updatePageContextSelection writes only the targeted project bucket", () => {
  const storage = createMemoryStorage({
    "data-editor:page-context": JSON.stringify({
      projects: {
        alpha: {
          selectedPath: "data/old.json",
          collectionPath: "$.old",
        scrollByView: {
          "data/old.json:$.old:main": {
            scrollTop: 40,
            scrollLeft: 10,
          },
        },
        queryByView: {},
      },
      beta: {
        selectedPath: "data/keep.json",
          collectionPath: "$.keep",
        scrollByView: {
          "data/keep.json:$.keep:side": {
            scrollTop: 18,
            scrollLeft: 4,
          },
        },
        queryByView: {},
      },
      },
    }),
  });

  updatePageContextSelection(storage, "alpha", {
    selectedPath: 99,
    collectionPath: "",
  });

  assert.deepEqual(readPageContextState(storage), {
    projects: {
      alpha: {
        selectedPath: null,
        collectionPath: "$",
        scrollByView: {
          "data/old.json:$.old:main": {
            scrollTop: 40,
            scrollLeft: 10,
          },
        },
        queryByView: {},
        expandedGroupId: null,
        lastActiveViewIdByGroupId: {},
      },
      beta: {
        selectedPath: "data/keep.json",
        collectionPath: "$.keep",
        scrollByView: {
          "data/keep.json:$.keep:side": {
            scrollTop: 18,
            scrollLeft: 4,
          },
        },
        queryByView: {},
        expandedGroupId: null,
        lastActiveViewIdByGroupId: {},
      },
    },
  });
});

test("updatePageContextSelection applies partial patch without resetting unspecified fields", () => {
  const storage = createMemoryStorage({
    "data-editor:page-context": JSON.stringify({
      projects: {
        alpha: {
          selectedPath: "data/old.json",
          collectionPath: "$.old",
        scrollByView: {
          "data/old.json:$.old:main": {
            scrollTop: 40,
            scrollLeft: 10,
          },
        },
        queryByView: {},
      },
      },
    }),
  });

  updatePageContextSelection(storage, "alpha", {
    collectionPath: "  $.new  ",
  });

  assert.deepEqual(readPageContextState(storage), {
    projects: {
      alpha: {
        selectedPath: "data/old.json",
        collectionPath: "$.new",
        scrollByView: {
          "data/old.json:$.old:main": {
            scrollTop: 40,
            scrollLeft: 10,
          },
        },
        queryByView: {},
        expandedGroupId: null,
        lastActiveViewIdByGroupId: {},
      },
    },
  });
});

test("updatePageContextScroll ignores invalid inputs and isolates scroll by project and view", () => {
  const storage = createMemoryStorage({
    "data-editor:page-context": JSON.stringify({
      projects: {
        beta: {
          selectedPath: "data/keep.json",
          collectionPath: "$",
        scrollByView: {
          "data/keep.json:$:side": {
            scrollTop: 50,
            scrollLeft: 6,
          },
        },
        queryByView: {},
      },
      },
    }),
  });

  updatePageContextScroll(storage, "alpha", {
    path: "data/runes.json",
    collectionPath: "",
    viewId: "main",
    scrollTop: 120,
    scrollLeft: 44,
  });

  updatePageContextScroll(storage, "alpha", {
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "",
    scrollTop: 200,
    scrollLeft: 80,
  });

  updatePageContextScroll(storage, "alpha", {
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "secondary",
    scrollTop: -20,
    scrollLeft: NaN,
  });

  assert.deepEqual(readPageContextState(storage), {
    projects: {
      beta: {
        selectedPath: "data/keep.json",
        collectionPath: "$",
        scrollByView: {
          "data/keep.json:$:side": {
            scrollTop: 50,
            scrollLeft: 6,
          },
        },
        queryByView: {},
        expandedGroupId: null,
        lastActiveViewIdByGroupId: {},
      },
      alpha: {
        selectedPath: null,
        collectionPath: "$",
        scrollByView: {
          "data/runes.json:$:main": {
            scrollTop: 120,
            scrollLeft: 44,
          },
        },
        queryByView: {},
        expandedGroupId: null,
        lastActiveViewIdByGroupId: {},
      },
    },
  });
});

test("updatePageContextQuery stores only local overrides and keeps other project state intact", () => {
  const storage = createMemoryStorage({
    "data-editor:page-context": JSON.stringify({
      projects: {
        alpha: {
          selectedPath: "data/runes.json",
          collectionPath: "$",
          scrollByView: {
            "data/runes.json:$:main": {
              scrollTop: 12,
              scrollLeft: 4,
            },
          },
          queryByView: {
            "data/runes.json:$:secondary": "shock",
          },
        },
      },
    }),
  });

  updatePageContextQuery(storage, "alpha", {
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "main",
    query: "fire",
    fallbackQuery: "",
  });

  updatePageContextQuery(storage, "alpha", {
    path: "data/runes.json",
    collectionPath: "$",
    viewId: "secondary",
    query: "",
    fallbackQuery: "",
  });

  assert.deepEqual(readPageContextState(storage), {
    projects: {
      alpha: {
        selectedPath: "data/runes.json",
        collectionPath: "$",
        scrollByView: {
          "data/runes.json:$:main": {
            scrollTop: 12,
            scrollLeft: 4,
          },
        },
        queryByView: {
          "data/runes.json:$:main": "fire",
        },
        expandedGroupId: null,
        lastActiveViewIdByGroupId: {},
      },
    },
  });
});

test("updatePageContextViewGrouping persists expanded group and last active child by group", () => {
  const storage = createMemoryStorage();

  updatePageContextViewGrouping(storage, "alpha", {
    expandedGroupId: "combat",
    lastActiveViewIdByGroupId: {
      combat: "damage",
    },
  });

  assert.deepEqual(readPageContextState(storage), {
    projects: {
      alpha: {
        selectedPath: null,
        collectionPath: "$",
        scrollByView: {},
        queryByView: {},
        expandedGroupId: "combat",
        lastActiveViewIdByGroupId: { combat: "damage" },
      },
    },
  });
});

test("readPageContextState drops invalid grouping state payload", () => {
  const storage = createMemoryStorage({
    "data-editor:page-context": JSON.stringify({
      projects: {
        alpha: {
          selectedPath: null,
          collectionPath: "$",
          scrollByView: {},
          queryByView: {},
          expandedGroupId: "   ",
          lastActiveViewIdByGroupId: {
            combat: "damage",
            "": "bad",
            utility: "",
          },
        },
      },
    }),
  });

  assert.deepEqual(readPageContextState(storage).projects.alpha.lastActiveViewIdByGroupId, {
    combat: "damage",
  });
  assert.equal(readPageContextState(storage).projects.alpha.expandedGroupId, null);
});

test("buildScrollContextKey normalizes collection path and rejects empty view id", () => {
  assert.equal(buildScrollContextKey("data/runes.json", "", "main"), "data/runes.json:$:main");
  assert.equal(buildScrollContextKey("data/runes.json", "$.sub", "table"), "data/runes.json:$.sub:table");
  assert.equal(buildScrollContextKey("data/runes.json", "$", ""), null);
});

test("buildViewContextKey shares the same normalization contract", () => {
  assert.equal(buildViewContextKey("data/runes.json", "", "main"), "data/runes.json:$:main");
  assert.equal(buildViewContextKey("data/runes.json", "$.sub", "table"), "data/runes.json:$.sub:table");
  assert.equal(buildViewContextKey("data/runes.json", "$", ""), null);
});

test("emptyPageContextState returns an empty root object", () => {
  assert.deepEqual(emptyPageContextState(), { projects: {} });
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
