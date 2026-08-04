import test from "node:test";
import assert from "node:assert/strict";
import { matchesContractSkillSource } from "../src/detail/node-schema-registry.mjs";

test("contract form scope does not depend on a project file path", () => {
  assert.equal(matchesContractSkillSource({ collectionPath: "skills", rootField: "nodes" }), true);
  assert.equal(matchesContractSkillSource({ collectionPath: "skills", rootField: "other" }), false);
  assert.equal(matchesContractSkillSource({ collectionPath: "other", rootField: "nodes" }), false);
});
