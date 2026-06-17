import test from "node:test";
import assert from "node:assert/strict";

import { focusWithoutScroll } from "../src/editing/focus-without-scroll.mjs";

test("focusWithoutScroll prefers preventScroll when supported", () => {
  const calls = [];
  const element = {
    focus(options) {
      calls.push(options);
    },
  };

  focusWithoutScroll(element);

  assert.deepEqual(calls, [{ preventScroll: true }]);
});

test("focusWithoutScroll falls back to plain focus when preventScroll is rejected", () => {
  const calls = [];
  let first = true;
  const element = {
    focus(options) {
      calls.push(options);
      if (first) {
        first = false;
        throw new TypeError("preventScroll unsupported");
      }
    },
  };

  focusWithoutScroll(element);

  assert.deepEqual(calls, [{ preventScroll: true }, undefined]);
});
