import assert from "node:assert/strict";
import test from "node:test";
import {
  autosaveDebugGlobalKey,
  autosaveDebugStorageKey,
  isAutosaveDebugEnabled,
  recordAutosaveDebugEvent,
} from "../src/autosave-debug.mjs";

function createStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

test("isAutosaveDebugEnabled checks localStorage and query string", () => {
  assert.equal(isAutosaveDebugEnabled({ storage: createStorage(), search: "" }), false);
  assert.equal(isAutosaveDebugEnabled({ storage: createStorage({ [autosaveDebugStorageKey]: "1" }), search: "" }), true);
  assert.equal(isAutosaveDebugEnabled({ storage: createStorage(), search: "?debugAutosave=1" }), true);
  assert.equal(isAutosaveDebugEnabled({ storage: createStorage(), search: "?debugAutosave=0" }), false);
});

test("recordAutosaveDebugEvent appends entries only when enabled and keeps a ring buffer", () => {
  const target = {};
  const writes = [];
  const consoleLike = {
    info(message, payload) {
      writes.push({ level: "info", message, payload });
    },
    warn(message, payload) {
      writes.push({ level: "warn", message, payload });
    },
    error(message, payload) {
      writes.push({ level: "error", message, payload });
    },
  };

  assert.equal(
    recordAutosaveDebugEvent(target, { kind: "request", status: "failure", url: "/api/save" }, {
      enabled: false,
      console: consoleLike,
    }),
    null,
  );
  assert.equal(target[autosaveDebugGlobalKey], undefined);

  recordAutosaveDebugEvent(target, { kind: "request", status: "failure", url: "/api/save" }, {
    enabled: true,
    console: consoleLike,
    maxEntries: 2,
  });
  recordAutosaveDebugEvent(target, { kind: "state", state: "error" }, {
    enabled: true,
    console: consoleLike,
    maxEntries: 2,
  });
  recordAutosaveDebugEvent(target, { kind: "state", state: "saving" }, {
    enabled: true,
    console: consoleLike,
    maxEntries: 2,
  });

  assert.equal(target[autosaveDebugGlobalKey].events.length, 2);
  assert.deepEqual(
    target[autosaveDebugGlobalKey].events.map((entry) => entry.kind === "state" ? entry.state : entry.status),
    ["error", "saving"],
  );
  assert.equal(writes.length, 3);
});
