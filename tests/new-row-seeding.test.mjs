import test from "node:test";
import assert from "node:assert/strict";
import { deriveNewRowSeedValues } from "../src/view/new-row-seeding.mjs";

test("deriveNewRowSeedValues seeds deterministic positive top-level filters", () => {
  const result = deriveNewRowSeedValues(
    {
      topLevelRules: [
        { kind: "rule", id: "status", field: "dev_status", operator: "is", value: "草稿" },
        { kind: "rule", id: "tags-1", field: "input_tags", operator: "contains", value: "melee" },
        { kind: "rule", id: "tags-2", field: "input_tags", operator: "contains", value: "weapon" },
      ],
      advancedRoot: null,
    },
    {
      dev_status: "Select",
      input_tags: "Multi-select",
    },
  );

  assert.deepEqual(result, {
    dev_status: "草稿",
    input_tags: ["melee", "weapon"],
  });
});

test("deriveNewRowSeedValues skips ambiguous and negative rules while keeping deterministic advanced rules", () => {
  const result = deriveNewRowSeedValues(
    {
      topLevelRules: [
        { kind: "rule", id: "query-like", field: "trait_name", operator: "contains", value: "近战" },
        { kind: "rule", id: "negative", field: "component_tags", operator: "does_not_contain", value: "utility" },
        { kind: "rule", id: "empty", field: "rating", operator: "is_not_empty" },
      ],
      advancedRoot: {
        kind: "group",
        id: "advanced-root",
        op: "and",
        children: [
          { kind: "rule", id: "level", field: "level", operator: "is", value: "B" },
        ],
      },
    },
    {
      trait_name: "Text",
      component_tags: "Multi-select",
      rating: "Select",
      level: "Select",
    },
  );

  assert.deepEqual(result, { level: "B" });
});

test("deriveNewRowSeedValues drops conflicting scalar assignments for the same field", () => {
  const result = deriveNewRowSeedValues(
    {
      topLevelRules: [
        { kind: "rule", id: "level-b", field: "level", operator: "is", value: "B" },
        { kind: "rule", id: "level-c", field: "level", operator: "is", value: "C" },
      ],
      advancedRoot: null,
    },
    {
      level: "Select",
    },
  );

  assert.deepEqual(result, {});
});

test("deriveNewRowSeedValues seeds a satisfiable branch from advanced OR groups", () => {
  const result = deriveNewRowSeedValues(
    {
      topLevelRules: [],
      advancedRoot: {
        kind: "group",
        id: "advanced-root",
        op: "or",
        children: [
          { kind: "rule", id: "input", field: "input_tags", operator: "contains", value: ["melee"] },
          { kind: "rule", id: "output", field: "output_tags", operator: "contains", value: ["melee"] },
        ],
      },
    },
    {
      input_tags: "Multi-select",
      output_tags: "Multi-select",
    },
  );

  assert.deepEqual(result, {
    input_tags: ["melee"],
  });
});

test("deriveNewRowSeedValues merges deterministic AND groups with nested OR branches", () => {
  const result = deriveNewRowSeedValues(
    {
      topLevelRules: [],
      advancedRoot: {
        kind: "group",
        id: "advanced-root",
        op: "and",
        children: [
          {
            kind: "group",
            id: "advanced-tags",
            op: "or",
            children: [
              { kind: "rule", id: "input", field: "input_tags", operator: "contains", value: ["melee"] },
              { kind: "rule", id: "output", field: "output_tags", operator: "contains", value: ["melee"] },
            ],
          },
          { kind: "rule", id: "type", field: "type", operator: "contains", value: ["positive"] },
        ],
      },
    },
    {
      input_tags: "Multi-select",
      output_tags: "Multi-select",
      type: "Select",
    },
  );

  assert.deepEqual(result, {
    input_tags: ["melee"],
    type: "positive",
  });
});
