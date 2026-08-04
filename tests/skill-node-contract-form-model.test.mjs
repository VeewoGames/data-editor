import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createSkillNodeContractEditorState } from "../src/detail/skill-node-contract-state.mjs";
import { createSkillNodeContractFormModel } from "../src/detail/skill-node-contract-form-model.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractFixtureRoot = path.join(repoRoot, "tests", "fixtures", "projects", "contract-project");
const contract = JSON.parse(await readFile(path.join(contractFixtureRoot, "data", "contracts", "skill_nodes.json"), "utf8"));

test("contract form model preserves loading and version mismatch blocking", () => {
  for (const state of [
    createSkillNodeContractEditorState({ status: "loading" }),
    createSkillNodeContractEditorState({ status: "ready", contract: { ...contract, contract_version: 999 }, version: 999, etag: "etag" }),
  ]) {
    const model = createSkillNodeContractFormModel(state);
    assert.equal(model.canEdit, false);
    assert.equal(model.resolveNestedNodeSchema({}).kind, "unsupported");
  }
});

test("contract form model evaluates conditional visibility, disabled state, and readonly fields", () => {
  const state = createSkillNodeContractEditorState({
    status: "ready",
    contract,
    version: contract.contract_version,
    etag: "contract-etag",
  });
  const model = createSkillNodeContractFormModel(state);
  const movement = model.resolveNestedNodeSchema({
    sourcePath: "data/content/skills.json",
    collectionPath: "skills",
    rootField: "nodes",
    nestedPath: [0],
    value: { type: "movement", mode: "push" },
  });
  const states = model.projectFieldStates(movement.schema, { type: "movement", mode: "push" });
  const targets = states.find((entry) => entry.field.fieldName === "targets");
  assert.equal(targets.visible, true);
  assert.equal(targets.disabled, false);

	const directionDash = model.resolveNestedNodeSchema({
		sourcePath: "data/content/skills.json",
		collectionPath: "skills",
		rootField: "nodes",
		nestedPath: [1],
		value: { type: "movement", mode: "dash" },
	});
	const directionStates = model.projectFieldStates(
		directionDash.schema,
		{ type: "movement", mode: "dash" },
		{ targeting: { selection: { type: "direction" } } },
	);
	const directionDistance = directionStates.find((entry) => entry.field.fieldName === "distance");
	assert.equal(directionDistance.visible, true);
	assert.equal(directionDistance.disabled, false);

  const targeting = model.resolveNestedNodeSchema({
    sourcePath: "data/content/skills.json",
    collectionPath: "skills",
    rootField: "nodes",
    nestedPath: [0],
    value: { type: "targeting" },
  });
  const circle = targeting.schema.fields.find((field) => field.fieldName === "area").nestedSchema.variants.circle;
  const anchor = model.projectFieldStates(circle, { shape: "circle" }).find((entry) => entry.field.fieldName === "anchor");
  assert.equal(anchor.readonly, true);
  assert.equal(anchor.disabled, true);
});

test("contract form model derives consumers and inherits affects for entity selection", () => {
  const model = readyModel();
  const targeting = {
    type: "targeting",
    selection: { type: "entity", distance: 3, relations: ["enemy", "neutral"] },
  };
  const rootValue = {
    nodes: [
      targeting,
      { type: "condition", then_nodes: [{ type: "damage", base_damage: 10 }] },
    ],
  };
  const schema = resolveTargetingSchema(model, targeting);
  const result = model.evaluateConstraints(schema, targeting, { rootValue });

  assert.equal(result.valid, true);
  assert.deepEqual(result.consumes, ["entities"]);
  assert.equal(result.affectsMode, "inherit_selection");
  assert.deepEqual(result.effectiveAffects, { relations: ["enemy", "neutral"] });
  assert.equal(result.consumerEntries.find((entry) => entry.nodeType === "damage")?.nodePath, "nodes/1/then_nodes/0");
});

test("contract form model requires explicit affects for non-entity selections with entity consumers", () => {
  const model = readyModel();
  for (const selection of [
    { type: "self" },
    { type: "cell", distance: 3, occupancy: "empty" },
    { type: "direction", directions: ["up"] },
  ]) {
    const targeting = { type: "targeting", selection };
    const rootValue = { nodes: [targeting, { type: "damage", base_damage: 10 }] };
    const result = model.evaluateConstraints(resolveTargetingSchema(model, targeting), targeting, { rootValue });
    assert.equal(result.valid, false, selection.type);
    assert.deepEqual(result.diagnostics, [{ code: "DEFINITION_AFFECTS_REQUIRED", fieldPath: "targeting.affects" }]);
    assert.equal(result.affectsMode, "required");

    const explicitTargeting = {
      ...targeting,
      affects: { relations: ["enemy"] },
      ...(selection.type === "direction" ? { area: { shape: "cone", size: 2 } } : {}),
    };
    const explicitRoot = { nodes: [explicitTargeting, { type: "damage", base_damage: 10 }] };
    const explicitResult = model.evaluateConstraints(
      resolveTargetingSchema(model, explicitTargeting),
      explicitTargeting,
      { rootValue: explicitRoot },
    );
    assert.equal(explicitResult.valid, true, `${selection.type} explicit affects`);
    assert.equal(explicitResult.affectsMode, "explicit");
    assert.deepEqual(explicitResult.effectiveAffects, { relations: ["enemy"] });
  }
});

test("contract form model forbids affects for cells-only consumers", () => {
  const model = readyModel();
  const targeting = {
    type: "targeting",
    selection: { type: "cell", distance: 3, occupancy: "empty" },
    affects: { relations: ["enemy"] },
  };
  const rootValue = { nodes: [targeting, { type: "terrain_creation" }] };
  const result = model.evaluateConstraints(resolveTargetingSchema(model, targeting), targeting, { rootValue });

  assert.deepEqual(result.consumes, ["cells"]);
  assert.deepEqual(result.diagnostics, [{ code: "DEFINITION_AFFECTS_FORBIDDEN", fieldPath: "targeting.affects" }]);
  assert.equal(result.affectsMode, "forbidden");
});

test("contract form model requires an area for direction affects", () => {
  const model = readyModel();
  const targeting = {
    type: "targeting",
    selection: { type: "direction", directions: ["up"] },
    affects: { relations: ["enemy"] },
  };
  const rootValue = { nodes: [targeting, { type: "damage", base_damage: 10 }] };
  const result = model.evaluateConstraints(resolveTargetingSchema(model, targeting), targeting, { rootValue });

  assert.deepEqual(result.diagnostics, [{ code: "INVALID_FIELD_COMBINATION", fieldPath: "targeting.affects" }]);
  assert.equal(result.valid, false);
});

test("contract form model executes mapped schema constraints with stable field paths", () => {
  const model = readyModel();
  const targeting = {
    type: "targeting",
    selection: { type: "direction", directions: ["up"] },
    area: { shape: "path", params: { width: 1 } },
  };
  const rootValue = { nodes: [targeting] };
  const result = model.evaluateConstraints(resolveTargetingSchema(model, targeting), targeting, { rootValue });

  assert.deepEqual(result.diagnostics, [{
    code: "TARGETING_SELECTION_AREA_COMPATIBILITY",
    fieldPath: "targeting.selection.type",
  }]);
});

test("contract form model executes integer and number min/max constraints from the contract", () => {
  for (const sample of [
    { type: "integer", min: 1, max: 3, valid: 2, below: 0, above: 4, fractional: 2.5 },
    { type: "number", min: 0.5, max: 3.5, valid: 2.5, below: 0.25, above: 4 },
  ]) {
    const modifiedContract = structuredClone(contract);
    modifiedContract.runtime_rules.validation.field_constraints["selection.distance"] = {
      type: sample.type,
      min: sample.min,
      max: sample.max,
      code: "DISTANCE_BOUND",
    };
    const model = readyModel(modifiedContract);
    const selectionSchema = resolveTargetingSchema(model, { type: "targeting" })
      .fields.find((field) => field.fieldName === "selection").nestedSchema.variants.entity;
    const evaluate = (distance) => model.evaluateConstraints(
      selectionSchema,
      { type: "entity", distance, relations: ["enemy"] },
      { targeting: { selection: { type: "entity", distance, relations: ["enemy"] } } },
    );
    assert.equal(evaluate(sample.valid).valid, true, `${sample.type} valid`);
    assert.deepEqual(evaluate(sample.below).diagnostics, [{ code: "DISTANCE_BOUND", fieldPath: "distance" }]);
    assert.deepEqual(evaluate(sample.above).diagnostics, [{ code: "DISTANCE_BOUND", fieldPath: "distance" }]);
    if (sample.type === "integer") {
      assert.deepEqual(evaluate(sample.fractional).diagnostics, [
        { code: "DISTANCE_BOUND", fieldPath: "distance" },
        { code: "DISTANCE_BOUND", fieldPath: "distance" },
      ]);
    }
  }
});

function readyModel(activeContract = contract) {
  return createSkillNodeContractFormModel(createSkillNodeContractEditorState({
    status: "ready",
    contract: activeContract,
    version: activeContract.contract_version,
    etag: "contract-etag",
  }));
}

function resolveTargetingSchema(model, targeting) {
  return model.resolveNestedNodeSchema({
    sourcePath: "data/content/skills.json",
    collectionPath: "skills",
    rootField: "nodes",
    nestedPath: [0],
    value: targeting,
  }).schema;
}
