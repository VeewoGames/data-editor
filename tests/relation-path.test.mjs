import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationKey, normalizeFieldPath } from "../src/model/relation-path.mjs";

test("buildRelationKey builds top level field key", () => {
  assert.equal(
    buildRelationKey({
      sourceFile: "data/enemies.json",
      sourceCollection: "enemies",
      fieldPath: ["skills"],
    }),
    "data/enemies.json:enemies:skills",
  );
});

test("buildRelationKey normalizes array indexes to wildcard", () => {
  assert.equal(normalizeFieldPath(["effects", 0, "trigger_skill_id"]), "effects.*.trigger_skill_id");
  assert.equal(
    buildRelationKey({
      sourceFile: "data/runes.json",
      sourceCollection: "$",
      fieldPath: ["effects", 0, "trigger_skill_id"],
    }),
    "data/runes.json:$:effects.*.trigger_skill_id",
  );
});
