import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationOptions, getRelationOptionLabel } from "../src/relations.mjs";
import { buildRelationIndex, validateRelationValue, validateRequired, validateUnique } from "../src/validation.mjs";

test("required validation flags empty values", () => {
  assert.equal(validateRequired("", "candidate_id").severity, "error");
  assert.equal(validateRequired("mini_multi_hit", "candidate_id"), null);
});

test("unique validation flags duplicate values", () => {
  const result = validateUnique([{ id: "a" }, { id: "a" }], "id");
  assert.equal(result.length, 2);
});

test("id-suffixed non-primary fields are not implicitly required or unique", () => {
  assert.equal(validateRequired("", "parent_candidate_id", { required: false }), null);

  const result = validateUnique([
    { candidate_id: "mini_attack_multi_hit", parent_candidate_id: "mini_multi_hit" },
    { candidate_id: "mini_spell_multi_hit", parent_candidate_id: "mini_multi_hit" },
  ], "parent_candidate_id", { unique: false });

  assert.equal(result.length, 0);
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
