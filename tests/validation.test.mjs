import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationOptions, getRelationOptionLabel } from "../src/relations.mjs";
import { buildRelationIndex, validateRelationValue, validateRequired, validateUnique } from "../src/validation.mjs";

test("required validation flags empty values", () => {
  assert.equal(validateRequired("", "rune_id").severity, "error");
  assert.equal(validateRequired("rune_fire", "rune_id"), null);
});

test("unique validation flags duplicate values", () => {
  const result = validateUnique([{ id: "a" }, { id: "a" }], "id");
  assert.equal(result.length, 2);
});

test("relation validation flags missing reference", () => {
  const index = buildRelationIndex([{ skill_id: "slash" }], "skill_id");
  assert.equal(validateRelationValue("slash", index), null);
  assert.equal(validateRelationValue("missing", index).severity, "warning");
});

test("relation options prefer name fields and fall back to id", () => {
  const options = buildRelationOptions([
    { skill_id: "slash", name: "斩击" },
    { skill_id: "ignite", skill_name: "点燃" },
    { skill_id: "unnamed" },
  ], "skill_id");

  assert.deepEqual(options, [
    { value: "slash", label: "斩击", description: "slash" },
    { value: "ignite", label: "点燃", description: "ignite" },
    { value: "unnamed", label: "unnamed", description: "" },
  ]);
});

test("relation option label falls back to raw id when missing", () => {
  const options = buildRelationOptions([{ keyword_id: "burn", name: "燃烧" }], "keyword_id");
  assert.equal(getRelationOptionLabel("burn", options), "燃烧");
  assert.equal(getRelationOptionLabel("unknown_keyword", options), "unknown_keyword");
});
