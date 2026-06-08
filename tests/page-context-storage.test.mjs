import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScrollContextKey,
  emptyPageContextState,
  readPageContextState,
  readProjectPageContext,
  updatePageContextScroll,
  updatePageContextSelection,
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
      },
      beta: {
        selectedPath: "data/status_effects.json",
        collectionPath: "$.effects",
        scrollByView: {},
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
      },
    },
  };

  assert.deepEqual(readProjectPageContext(state, "alpha"), state.projects.alpha);
  assert.deepEqual(readProjectPageContext(state, ""), {
    selectedPath: null,
    collectionPath: "$",
    scrollByView: {},
  });
  assert.deepEqual(readProjectPageContext(state, "missing"), {
    selectedPath: null,
    collectionPath: "$",
    scrollByView: {},
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
      },
    },
  });
});

test("buildScrollContextKey normalizes collection path and rejects empty view id", () => {
  assert.equal(buildScrollContextKey("data/runes.json", "", "main"), "data/runes.json:$:main");
  assert.equal(buildScrollContextKey("data/runes.json", "$.sub", "table"), "data/runes.json:$.sub:table");
  assert.equal(buildScrollContextKey("data/runes.json", "$", ""), null);
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
