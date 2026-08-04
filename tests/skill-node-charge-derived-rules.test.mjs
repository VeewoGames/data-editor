import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createSkillNodeContractFormModel } from "../src/detail/skill-node-contract-form-model.mjs";
import { createSkillNodeContractEditorState } from "../src/detail/skill-node-contract-state.mjs";
import {
  buildChargeDerivedSummary,
  validateSkillNodeDerivedRuleConflicts,
} from "../src/detail/skill-node-derived-rules.mjs";

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractFixtureRoot = path.join(editorRoot, "tests", "fixtures", "projects", "contract-project");
const contract = JSON.parse(await readFile(path.join(contractFixtureRoot, "data", "contracts", "skill_nodes.json"), "utf8"));

test("charge targeting only exposes distance and relations plus a non-persistent derived summary", () => {
  const skill = validChargeSkill();
  const model = readyModel();
  const targeting = model.resolveNestedNodeSchema({
    sourcePath: "data/content/skills.json",
    collectionPath: "skills",
    rootField: "nodes",
    nestedPath: [0],
    value: skill.nodes[0],
  });
  const selectionSchema = targeting.schema.fields.find((field) => field.fieldName === "selection").nestedSchema.variants.entity;
  const visible = model.projectFieldStates(selectionSchema, skill.nodes[0].selection, { rootValue: skill })
    .filter((state) => state.visible)
    .map((state) => state.field.fieldName);

  assert.deepEqual(visible, ["distance", "relations"]);
  assert.equal(model.canSwitchDiscriminator(selectionSchema, { rootValue: skill }), false);
  assert.deepEqual(model.getDerivedRuleSummary(selectionSchema, { rootValue: skill }), [
    { label: "选取形状", value: "四方向直线" },
    { label: "允许方向", value: "上 / 右 / 下 / 左" },
    { label: "路径规则", value: "直线且路径可通行" },
    { label: "目标规则", value: "单个主目标" },
  ]);
  assert.deepEqual(buildChargeDerivedSummary(contract, skill), model.getDerivedRuleSummary(selectionSchema, { rootValue: skill }));
  assert.deepEqual(skill, validChargeSkill(), "derived projection must not write fields back into the skill");
});

test("charge hides movement.distance and blocks legacy explicit derived fields", () => {
  const model = readyModel();
  const skill = validChargeSkill();
  const movementSchema = model.resolveNestedNodeSchema({
    sourcePath: "data/content/skills.json",
    collectionPath: "skills",
    rootField: "nodes",
    nestedPath: [1],
    value: skill.nodes[1],
  }).schema;
  const movementStates = model.projectFieldStates(movementSchema, skill.nodes[1], { rootValue: skill });
  assert.equal(movementStates.find((state) => state.field.fieldName === "distance").visible, false);

  const conflicted = validChargeSkill();
  Object.assign(conflicted.nodes[0].selection, {
    pattern: "diamond",
    directions: ["up"],
    visibility: "ignore",
    min_targets: 1,
    max_targets: 1,
  });
  conflicted.nodes[1].distance = 3;
  const before = JSON.stringify(conflicted);
  const result = validateSkillNodeDerivedRuleConflicts(contract, {
    skill_node_contract_version: contract.contract_version,
    skills: [conflicted],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map((entry) => entry.fieldPath), [
    "skills[0].nodes[0].selection.visibility",
    "skills[0].nodes[0].selection.pattern",
    "skills[0].nodes[0].selection.directions",
    "skills[0].nodes[0].selection.min_targets",
    "skills[0].nodes[0].selection.max_targets",
    "skills[0].nodes[1].distance",
  ]);
  assert.match(result.issues[0].message, /共享合同派生/);
  assert.equal(JSON.stringify(conflicted), before, "validation must not normalize or mutate legacy data");
});

test("charge validation accepts only selection distance and relations as authored targeting fields", () => {
  const result = validateSkillNodeDerivedRuleConflicts(contract, {
    skill_node_contract_version: contract.contract_version,
    skills: [validChargeSkill()],
  });
  assert.deepEqual(result, { ok: true, issues: [] });
});

function readyModel() {
  return createSkillNodeContractFormModel(createSkillNodeContractEditorState({
    status: "ready",
    contract,
    version: contract.contract_version,
    etag: "contract-etag",
  }));
}

function validChargeSkill() {
  return {
    skill_id: "skill_charge_test",
    nodes: [
      { type: "targeting", selection: { type: "entity", distance: 3, relations: ["enemy"] } },
      { type: "movement", mode: "charge" },
      { type: "damage", base_damage: 10 },
    ],
  };
}
