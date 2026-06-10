import test from "node:test";
import assert from "node:assert/strict";
import { isCompatible } from "../src/field-types.mjs";

test("Multi-select treats missing values as empty", () => {
  assert.equal(isCompatible("Multi-select", undefined), true);
  assert.equal(isCompatible("Multi-select", null), true);
});

test("Number treats missing values as empty", () => {
  assert.equal(isCompatible("Number", undefined), true);
  assert.equal(isCompatible("Number", null), true);
});

test("Checkbox treats missing values as empty", () => {
  assert.equal(isCompatible("Checkbox", undefined), true);
  assert.equal(isCompatible("Checkbox", null), true);
});
