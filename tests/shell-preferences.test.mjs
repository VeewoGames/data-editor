import assert from "node:assert/strict";
import test from "node:test";
import { readSidebarCollapsed, sidebarCollapsedStorageKey, writeSidebarCollapsed } from "../src/shell-preferences.mjs";

function createMemoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("sidebar collapsed preference defaults to expanded and rejects invalid values", () => {
  assert.equal(readSidebarCollapsed(createMemoryStorage()), false);
  assert.equal(readSidebarCollapsed(createMemoryStorage({ [sidebarCollapsedStorageKey]: "0" })), false);
  assert.equal(readSidebarCollapsed(createMemoryStorage({ [sidebarCollapsedStorageKey]: "invalid" })), false);
  assert.equal(readSidebarCollapsed(createMemoryStorage({ [sidebarCollapsedStorageKey]: "1" })), true);
});

test("sidebar collapsed preference writes only its independent shell key", () => {
  const storage = createMemoryStorage({ "data-editor:sidebar-width": "320" });
  writeSidebarCollapsed(storage, true);
  assert.equal(storage.getItem(sidebarCollapsedStorageKey), "1");
  assert.equal(storage.getItem("data-editor:sidebar-width"), "320");
  writeSidebarCollapsed(storage, false);
  assert.equal(storage.getItem(sidebarCollapsedStorageKey), "0");
});
