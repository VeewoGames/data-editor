import test from "node:test";
import assert from "node:assert/strict";
import { resolveAutoSuffixedPrimaryKeyValue } from "../src/model/primary-key-auto-suffix.mjs";

test("resolveAutoSuffixedPrimaryKeyValue keeps non-conflicting primary key values unchanged", () => {
  const result = resolveAutoSuffixedPrimaryKeyValue({
    rows: [
      { id: "alpha" },
      { id: "beta" },
    ],
    fieldName: "id",
    value: "gamma",
    excludeRowIndex: null,
  });

  assert.deepEqual(result, {
    value: "gamma",
    adjusted: false,
  });
});

test("resolveAutoSuffixedPrimaryKeyValue appends the next numeric suffix for duplicate primary key values", () => {
  const result = resolveAutoSuffixedPrimaryKeyValue({
    rows: [
      { id: "alpha" },
      { id: "alpha_1" },
      { id: "alpha_2" },
    ],
    fieldName: "id",
    value: "alpha",
    excludeRowIndex: null,
  });

  assert.deepEqual(result, {
    value: "alpha_3",
    adjusted: true,
  });
});

test("resolveAutoSuffixedPrimaryKeyValue ignores the edited row when checking duplicates", () => {
  const result = resolveAutoSuffixedPrimaryKeyValue({
    rows: [
      { id: "alpha" },
      { id: "beta" },
    ],
    fieldName: "id",
    value: "beta",
    excludeRowIndex: 1,
  });

  assert.deepEqual(result, {
    value: "beta",
    adjusted: false,
  });
});

test("resolveAutoSuffixedPrimaryKeyValue increments numeric primary keys instead of appending string suffixes", () => {
  const result = resolveAutoSuffixedPrimaryKeyValue({
    rows: [
      { id: 476 },
      { id: 477 },
    ],
    fieldName: "id",
    value: 476,
    excludeRowIndex: null,
  });

  assert.deepEqual(result, {
    value: 478,
    adjusted: true,
  });
});
