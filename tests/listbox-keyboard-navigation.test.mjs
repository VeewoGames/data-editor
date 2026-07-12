import test from "node:test";
import assert from "node:assert/strict";
import { isListboxNavigationKey, resolveListboxNavigationIndex } from "../src/components/listbox-keyboard-navigation.mjs";

test("listbox keyboard navigation wraps and supports first/last jumps", () => {
  assert.equal(resolveListboxNavigationIndex({ currentIndex: 2, itemCount: 3, key: "ArrowDown" }), 0);
  assert.equal(resolveListboxNavigationIndex({ currentIndex: 0, itemCount: 3, key: "ArrowUp" }), 2);
  assert.equal(resolveListboxNavigationIndex({ currentIndex: 1, itemCount: 3, key: "Home" }), 0);
  assert.equal(resolveListboxNavigationIndex({ currentIndex: 1, itemCount: 3, key: "End" }), 2);
  assert.equal(resolveListboxNavigationIndex({ currentIndex: -1, itemCount: 0, key: "ArrowDown" }), -1);
});

test("listbox keyboard navigation recognizes only movement keys", () => {
  assert.equal(isListboxNavigationKey("ArrowDown"), true);
  assert.equal(isListboxNavigationKey("End"), true);
  assert.equal(isListboxNavigationKey("Enter"), false);
  assert.equal(isListboxNavigationKey("Escape"), false);
});
