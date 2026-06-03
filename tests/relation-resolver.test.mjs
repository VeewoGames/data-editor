import test from "node:test";
import assert from "node:assert/strict";
import { resolveRelationField } from "../src/model/relation-resolver.mjs";

test("resolver uses config mode instead of value shape", () => {
  const result = resolveRelationField({
    sourceFile: "data/runes.json",
    sourceCollection: "$",
    fieldPath: ["rune_id"],
    value: ["rune_a"],
    viewConfig: {
      fields: {},
      relationsVersion: 1,
      relations: {
        "data/runes.json:$:rune_id": {
          targetFile: "data/runes.json",
          targetCollection: "$",
          targetKey: "rune_id",
          mode: "single",
          titleFields: ["rune_name"],
          allowMissing: false,
        },
      },
    },
    relationIndexes: {},
  });

  assert.equal(result.kind, "incompatible");
});

test("resolver returns missing values for configured multi relation", () => {
  const result = resolveRelationField({
    sourceFile: "data/enemies.json",
    sourceCollection: "enemies",
    fieldPath: ["skills"],
    value: ["slash", "missing"],
    viewConfig: {
      fields: {},
      relationsVersion: 1,
      relations: {
        "data/enemies.json:enemies:skills": {
          targetFile: "data/skills.json",
          targetCollection: "skills",
          targetKey: "skill_id",
          mode: "multi",
          titleFields: ["skill_name"],
          allowMissing: false,
        },
      },
    },
    relationIndexes: { "data/enemies.json:enemies:skills": new Set(["slash"]) },
  });

  assert.equal(result.kind, "configured");
  assert.deepEqual(result.missingValues, ["missing"]);
});
