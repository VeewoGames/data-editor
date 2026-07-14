import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  createSkillNodeContractRegistryAdapter,
  resolveNestedNodeSchema,
} from "../src/detail/node-schema-registry.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nocturnelRoot = process.env.NOCTURNEL_ROOT
  ? path.resolve(process.env.NOCTURNEL_ROOT)
  : path.basename(path.dirname(repoRoot)) === "tools"
    ? path.resolve(repoRoot, "..", "..")
    : path.resolve(repoRoot, "..", "Nocturnel");
const contract = JSON.parse(await readFile(path.resolve(nocturnelRoot, "data", "contracts", "skill_nodes.json"), "utf8"));
const contractMetaSchema = JSON.parse(await readFile(path.resolve(nocturnelRoot, "data", "contracts", "skill_nodes.schema.json"), "utf8"));
const baseContext = {
  sourcePath: "C:/Code/Nocturnel/data/content/skills.json",
  collectionPath: "skills",
  rootField: "nodes",
};

test("shared meta-schema rejects array and dict fields without their child schema", () => {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(contractMetaSchema);
  const arrayItemMissing = structuredClone(contract);
  delete arrayItemMissing.nodes.sequence.fields.find((field) => field.name === "children").items;
  assert.equal(validate(arrayItemMissing), false);
  assert.ok(validate.errors.some((error) => error.keyword === "required" && error.params.missingProperty === "items"));

  const dictFieldsMissing = structuredClone(contract);
  delete dictFieldsMissing.nodes.summon.fields.find((field) => field.name === "base_stats").fields;
  assert.equal(validate(dictFieldsMissing), false);
  assert.ok(validate.errors.some((error) => error.keyword === "required" && error.params.missingProperty === "fields"));
});

test("shared contract adapter rejects incomplete or ambiguous affects constraint declarations", () => {
  const missingConstraint = structuredClone(contract);
  missingConstraint.runtime_rules.targeting.affects.constraints.pop();
  assert.throws(
    () => createSkillNodeContractRegistryAdapter(missingConstraint),
    /must be declared exactly once; received 0/,
  );

  const duplicatedOperator = structuredClone(contract);
  duplicatedOperator.runtime_rules.targeting.affects.constraints[2].operator =
    duplicatedOperator.runtime_rules.targeting.affects.constraints[1].operator;
  assert.throws(
    () => createSkillNodeContractRegistryAdapter(duplicatedOperator),
    /must be declared exactly once; received 2/,
  );

  const unknownCodeKey = structuredClone(contract);
  unknownCodeKey.runtime_rules.targeting.affects.constraints[0].code_key = "missing_code";
  assert.throws(
    () => createSkillNodeContractRegistryAdapter(unknownCodeKey),
    /references an unknown or empty blocking code: missing_code/,
  );

  const emptyBlockingCode = structuredClone(contract);
  const codeKey = emptyBlockingCode.runtime_rules.targeting.affects.constraints[0].code_key;
  emptyBlockingCode.runtime_rules.validation.blocking_codes[codeKey] = "";
  assert.throws(
    () => createSkillNodeContractRegistryAdapter(emptyBlockingCode),
    /references an unknown or empty blocking code/,
  );
});

test("shared contract adapter is isolated from the static production registry and matches only the formal skill path", () => {
  const staticResult = resolveNestedNodeSchema({ ...baseContext, nestedPath: [0], value: { type: "targeting" } });
  assert.equal(staticResult.kind, "unsupported");

  const adapter = createSkillNodeContractRegistryAdapter(contract);
  const supported = adapter.resolveNestedNodeSchema({ ...baseContext, nestedPath: [0], value: { type: "targeting" } });
  assert.equal(supported.kind, "supported");
  assert.equal(supported.currentDiscriminator, "targeting");
  assert.deepEqual(supported.schema.fields.map((field) => field.fieldName), ["selection", "area", "affects"]);

  const legacyPath = adapter.resolveNestedNodeSchema({
    ...baseContext,
    sourcePath: "C:/Code/Nocturnel/data/skills.json",
    nestedPath: [0],
    value: { type: "targeting" },
  });
  assert.equal(legacyPath.kind, "unsupported");

  const windowsCase = adapter.resolveNestedNodeSchema({
    ...baseContext,
    sourcePath: "C:\\CODE\\NOCTURNEL\\DATA\\CONTENT\\SKILLS.JSON",
    nestedPath: [0],
    value: { type: "targeting" },
  });
  assert.equal(windowsCase.kind, "supported");

  for (const sourcePath of [
    "C:/Code/Nocturnel/metadata/content/skills.json",
    "C:/Code/Nocturnel/xdata/content/skills.json",
  ]) {
    const falsePositive = adapter.resolveNestedNodeSchema({
      ...baseContext,
      sourcePath,
      nestedPath: [0],
      value: { type: "targeting" },
    });
    assert.equal(falsePositive.kind, "unsupported");
  }
});

test("shared contract adapter creates the first draft for an empty nodes array without static fallback", () => {
  const adapter = createSkillNodeContractRegistryAdapter(contract);
  const draft = adapter.resolveNestedNodeSchema({
    ...baseContext,
    nestedPath: [0],
    value: {},
    contextValue: null,
  });

  assert.equal(draft.kind, "supported");
  assert.equal(draft.currentDiscriminator, "targeting");
  assert.deepEqual(draft.schema.defaultValue, { type: "targeting" });
});

test("shared contract adapter maps selection, area, affects, and movement metadata", () => {
  const adapter = createSkillNodeContractRegistryAdapter(contract);
  const targeting = adapter.resolveNestedNodeSchema({ ...baseContext, nestedPath: [0], value: { type: "targeting" } });
  const selectionField = targeting.schema.fields.find((field) => field.fieldName === "selection");
  const areaField = targeting.schema.fields.find((field) => field.fieldName === "area");
  const affectsField = targeting.schema.fields.find((field) => field.fieldName === "affects");
  assert.equal(selectionField.required, true);
  assert.equal(selectionField.nestedSchema.discriminatorField, "type");
  assert.equal(areaField.nestedSchema.discriminatorField, "shape");
  assert.equal(affectsField.nestedSchema.nodeKind, "object");
  assert.ok(targeting.schema.constraints.some((constraint) => constraint.code === "TARGETING_SELECTION_AREA_COMPATIBILITY"));
  assert.ok(targeting.schema.constraints.some((constraint) => constraint.code === "DEFINITION_AFFECTS_REQUIRED"));
  assert.ok(targeting.schema.constraints.some((constraint) => constraint.code === "DEFINITION_AFFECTS_FORBIDDEN"));

  const selection = adapter.resolveNestedNodeSchema({
    ...baseContext,
    nestedPath: [0, "selection"],
    value: { type: "entity" },
    contextValue: { type: "targeting" },
  });
  assert.equal(selection.kind, "supported");
  const relations = selection.schema.fields.find((field) => field.fieldName === "relations");
  const pattern = selection.schema.fields.find((field) => field.fieldName === "pattern");
  assert.equal(relations.displayType, "Multi-select");
  assert.equal(relations.required, true);
  assert.deepEqual(relations.options.map((option) => option.value), ["self", "ally", "enemy", "neutral"]);
  assert.equal(relations.arrayItem.valueType, "string");
  assert.equal(pattern.defaultValue, "diamond");
  assert.equal(pattern.omitWhenDefault, true);
  assert.deepEqual(pattern.visibleWhen, { fieldName: "type", operator: "equals", value: "entity" });

  const rectangle = areaField.nestedSchema.variants.rectangle;
  const params = rectangle.fields.find((field) => field.fieldName === "params");
  assert.equal(params.required, true);
  assert.deepEqual(params.nestedSchema.fields.map((field) => field.fieldName), ["width", "height"]);
  assert.equal(rectangle.fields.find((field) => field.fieldName === "anchor").readonly, true);

  const affectsRelations = affectsField.nestedSchema.fields.find((field) => field.fieldName === "relations");
  assert.equal(affectsRelations.displayType, "Multi-select");
  assert.equal(affectsRelations.required, true);

  const movement = adapter.resolveNestedNodeSchema({ ...baseContext, nestedPath: [0], value: { type: "movement" } });
  const mode = movement.schema.fields.find((field) => field.fieldName === "mode");
  const targets = movement.schema.fields.find((field) => field.fieldName === "targets");
  assert.deepEqual(mode.options.map((option) => option.value), ["move", "dash", "leap", "teleport", "charge", "push", "pull"]);
  assert.equal(targets.defaultValue, "selected");
  assert.equal(targets.omitWhenDefault, true);
  assert.deepEqual(targets.visibleWhen.values, ["push", "pull"]);
  assert.deepEqual(targets.disabledWhen.values, ["push", "pull"]);
  assert.ok(movement.schema.constraints.some((constraint) => constraint.code === "MOVEMENT_REQUIRED_FIELD"));
});

test("shared contract adapter derives recursive and movement consumers from contract metadata", () => {
  const adapter = createSkillNodeContractRegistryAdapter(contract);
  const nested = adapter.deriveNodeConsumes([
    { type: "targeting", selection: { type: "entity" } },
    { type: "condition", then_nodes: [{ type: "damage" }] },
    { type: "terrain_creation" },
  ], { selection: { type: "entity" } });
  assert.deepEqual(nested.consumes, ["cells", "entities"]);
  assert.equal(nested.entries.find((entry) => entry.nodeType === "damage")?.nodePath, "nodes/1/then_nodes/0");

  const directionDash = adapter.deriveNodeConsumes(
    [{ type: "movement", mode: "dash", distance: 3 }],
    { selection: { type: "direction" } },
  );
  assert.deepEqual(directionDash.consumes, ["direction"]);

  const cellDash = adapter.deriveNodeConsumes(
    [{ type: "movement", mode: "dash" }],
    { selection: { type: "cell" } },
  );
  assert.deepEqual(cellDash.consumes, ["cells"]);
});

test("shared contract adapter maps generic enums, defaults, visible conditions, and recursive node paths", () => {
  const conditionalContract = structuredClone(contract);
  conditionalContract.nodes.damage.fields.find((field) => field.name === "element").visible_when = { damage_type: ["fire", "cold"] };
  const adapter = createSkillNodeContractRegistryAdapter(conditionalContract);
  const damage = adapter.resolveNestedNodeSchema({
    ...baseContext,
    nestedPath: [0, "then_nodes", 0],
    value: { type: "damage" },
  });
  assert.equal(damage.kind, "supported");
  const element = damage.schema.fields.find((field) => field.fieldName === "element");
  assert.equal(element.displayType, "Select");
  assert.equal(element.defaultValue, "physical");
  assert.equal(element.omitWhenDefault, true);
  assert.deepEqual(element.visibleWhen, { fieldName: "damage_type", operator: "in", values: ["fire", "cold"] });
  assert.equal(damage.schema.omitDefaults, true);
});

test("shared contract adapter preserves dash_cell and dash_direction distance rules", () => {
  const adapter = createSkillNodeContractRegistryAdapter(contract);
  const movement = adapter.resolveNestedNodeSchema({ ...baseContext, nestedPath: [0], value: { type: "movement" } });
  const distance = movement.schema.fields.find((field) => field.fieldName === "distance");
  const dashVisibility = distance.visibleWhen.conditions.find((condition) =>
    condition.operator === "all"
    && condition.conditions.some((item) => item.fieldName === "mode" && item.value === "dash"));
  assert.deepEqual(dashVisibility, {
    operator: "all",
    conditions: [
      { fieldName: "mode", operator: "equals", value: "dash" },
      { fieldName: "selection.type", operator: "equals", value: "direction" },
    ],
  });
  assert.equal(distance.visibleWhen.conditions.some((condition) =>
    condition.operator === "all"
    && condition.conditions.some((item) => item.fieldName === "selection.type" && item.value === "cell")), false);

  const dashConstraints = movement.schema.constraints.filter((constraint) =>
    constraint.code === "MOVEMENT_REQUIRED_FIELD" && constraint.fieldNames.includes("distance"));
  assert.equal(dashConstraints.some((constraint) => constraint.sourceVariant === "dash_cell"), false);
  assert.deepEqual(dashConstraints.find((constraint) => constraint.sourceVariant === "dash_direction")?.when, dashVisibility);
});

test("shared contract adapter maps non-empty arrays, integer minima, and custom offset pairs", () => {
  const adapter = createSkillNodeContractRegistryAdapter(contract);
  const targeting = adapter.resolveNestedNodeSchema({ ...baseContext, nestedPath: [0], value: { type: "targeting" } });
  const selection = adapter.resolveNestedNodeSchema({
    ...baseContext,
    nestedPath: [0, "selection"],
    value: { type: "entity" },
    contextValue: { type: "targeting" },
  });
  const selectionArrayConstraints = selection.schema.constraints.filter((constraint) => constraint.code === "SELECTION_NON_EMPTY_ARRAY");
  assert.deepEqual(
    selectionArrayConstraints,
    [
      { code: "SELECTION_NON_EMPTY_ARRAY", kind: "custom", fieldNames: ["relations"], operator: "non_empty_array" },
      { code: "SELECTION_NON_EMPTY_ARRAY", kind: "custom", fieldNames: ["entity_types"], operator: "non_empty_array" },
      { code: "SELECTION_NON_EMPTY_ARRAY", kind: "custom", fieldNames: ["directions"], operator: "non_empty_array" },
    ],
  );
  assert.equal(violatesMappedConstraint(selectionArrayConstraints[0], []), true);

  const area = targeting.schema.fields.find((field) => field.fieldName === "area").nestedSchema;
  const rectangleConstraints = area.variants.rectangle.fields.find((field) => field.fieldName === "params").nestedSchema.constraints;
  assert.deepEqual(
    rectangleConstraints.filter((constraint) => constraint.code === "AREA_PARAM_INTEGER_MIN"),
    [
      { code: "AREA_PARAM_INTEGER_MIN", kind: "custom", fieldNames: ["width"], operator: "integer_min", value: 1 },
      { code: "AREA_PARAM_INTEGER_MIN", kind: "custom", fieldNames: ["height"], operator: "integer_min", value: 1 },
    ],
  );
  const customConstraints = area.variants.custom.fields.find((field) => field.fieldName === "params").nestedSchema.constraints;
  const offsetsNonEmpty = customConstraints.find((constraint) => constraint.code === "AREA_PARAM_NON_EMPTY_ARRAY");
  const offsetsPairs = customConstraints.find((constraint) => constraint.code === "AREA_PARAM_OFFSET_PAIR_INTEGERS");
  assert.equal(offsetsNonEmpty.fieldNames[0], "offsets");
  assert.equal(offsetsPairs.fieldNames[0], "offsets");
  assert.equal(violatesMappedConstraint(offsetsNonEmpty, []), true);
  assert.equal(violatesMappedConstraint(offsetsPairs, [[1]]), true);
  assert.equal(violatesMappedConstraint(offsetsPairs, [[1, "2"]]), true);
  assert.equal(violatesMappedConstraint(offsetsPairs, [[1, 2]]), false);

  const affects = targeting.schema.fields.find((field) => field.fieldName === "affects").nestedSchema;
  assert.ok(affects.constraints.some((constraint) => constraint.code === "AFFECTS_NON_EMPTY_ARRAY"
    && constraint.fieldNames[0] === "relations"));
});

test("shared contract adapter projects declared numeric bounds and contract-owned error codes", () => {
  const adapter = createSkillNodeContractRegistryAdapter(contract);
  const selection = adapter.resolveNestedNodeSchema({
    ...baseContext,
    nestedPath: [0, "selection"],
    value: { type: "entity" },
    contextValue: { type: "targeting" },
  });
  for (const [fieldName, minimum] of [["distance", 0], ["min_targets", 1], ["max_targets", 1]]) {
    const field = selection.schema.fields.find((item) => item.fieldName === fieldName);
    assert.equal(field.valueType, "int");
    assert.equal(field.min, minimum);
    assert.ok(selection.schema.constraints.some((constraint) =>
      constraint.code === contract.runtime_rules.validation.field_constraints[`selection.${fieldName}`].code
      && constraint.fieldNames[0] === fieldName
      && constraint.operator === "integer_min"
      && constraint.value === minimum));
  }

  const targeting = adapter.resolveNestedNodeSchema({ ...baseContext, nestedPath: [0], value: { type: "targeting" } });
  const circle = targeting.schema.fields.find((field) => field.fieldName === "area").nestedSchema.variants.circle;
  assert.equal(circle.fields.find((field) => field.fieldName === "size").min, 1);
  assert.ok(circle.constraints.some((constraint) =>
    constraint.code === contract.runtime_rules.validation.field_constraints["area.size"].code
    && constraint.fieldNames[0] === "size"));

  const movement = adapter.resolveNestedNodeSchema({ ...baseContext, nestedPath: [0], value: { type: "movement" } });
  assert.equal(movement.schema.fields.find((field) => field.fieldName === "distance").min, 1);
  assert.ok(movement.schema.constraints.some((constraint) =>
    constraint.code === contract.runtime_rules.validation.field_constraints["movement.distance"].code
    && constraint.fieldNames[0] === "distance"));
  assert.equal(
    movement.schema.constraints.find((constraint) => constraint.kind === "required").code,
    contract.runtime_rules.validation.blocking_codes.movement_required_field,
  );
});

test("shared contract adapter maps recursive node arrays as skill-node objects", () => {
  const adapter = createSkillNodeContractRegistryAdapter(contract);
  for (const [nodeType, fieldName] of [
    ["condition", "then_nodes"],
    ["condition", "else_nodes"],
    ["sequence", "children"],
    ["delayed_cast", "children"],
  ]) {
    const result = adapter.resolveNestedNodeSchema({ ...baseContext, nestedPath: [0], value: { type: nodeType } });
    assert.deepEqual(result.schema.fields.find((field) => field.fieldName === fieldName).arrayItem, {
      valueType: "object",
      schemaRef: "skill-node",
    });
  }

  const recursive = adapter.resolveNestedNodeSchema({
    ...baseContext,
    nestedPath: [0, "children", 0, "then_nodes", 0],
    value: { type: "damage" },
  });
  assert.equal(recursive.kind, "supported");
  assert.equal(recursive.currentDiscriminator, "damage");

  const targeting = adapter.resolveNestedNodeSchema({ ...baseContext, nestedPath: [0], value: { type: "targeting" } });
  const relations = targeting.schema.fields.find((field) => field.fieldName === "affects")
    .nestedSchema.fields.find((field) => field.fieldName === "relations");
  assert.equal(relations.arrayItem.valueType, "string");
});

test("shared contract adapter derives new recursive node paths from meta-schema-valid contract fields", () => {
  const extended = structuredClone(contract);
  extended.nodes.sequence.fields.push({ name: "steps", type: "array", default: [], items: { type: "node" } });
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(contractMetaSchema);
  assert.equal(validate(extended), true, JSON.stringify(validate.errors));

  const adapter = createSkillNodeContractRegistryAdapter(extended);
  const sequence = adapter.resolveNestedNodeSchema({ ...baseContext, nestedPath: [0], value: { type: "sequence" } });
  assert.deepEqual(sequence.schema.fields.find((field) => field.fieldName === "steps").arrayItem, {
    valueType: "object",
    schemaRef: "skill-node",
  });
  const recursive = adapter.resolveNestedNodeSchema({
    ...baseContext,
    nestedPath: [0, "steps", 0],
    value: { type: "damage" },
  });
  assert.equal(recursive.kind, "supported");
  assert.equal(recursive.currentDiscriminator, "damage");
});

test("shared contract adapter reads targeting nested path names from root_fields", () => {
  const narrowed = structuredClone(contract);
  narrowed.runtime_rules.targeting.root_fields = narrowed.runtime_rules.targeting.root_fields
    .filter((fieldName) => fieldName !== "affects");
  const adapter = createSkillNodeContractRegistryAdapter(narrowed);
  const affects = adapter.resolveNestedNodeSchema({
    ...baseContext,
    nestedPath: [0, "affects"],
    value: {},
    contextValue: { type: "targeting" },
  });
  assert.equal(affects.kind, "unsupported");
});

test("shared contract adapter preserves numeric types, bounds, and contract-declared array items", () => {
  const adapter = createSkillNodeContractRegistryAdapter(contract);
  const damage = adapter.resolveNestedNodeSchema({ ...baseContext, nestedPath: [0], value: { type: "damage" } });
  const baseDamage = damage.schema.fields.find((field) => field.fieldName === "base_damage");
  const multiHitCount = damage.schema.fields.find((field) => field.fieldName === "multi_hit_count");
  assert.equal(baseDamage.valueType, "float");
  assert.equal(baseDamage.min, 0);
  assert.equal(Object.hasOwn(baseDamage, "max"), false);
  assert.deepEqual(
    { valueType: multiHitCount.valueType, min: multiHitCount.min, max: multiHitCount.max },
    { valueType: "int", min: 1, max: 10 },
  );

  const summon = adapter.resolveNestedNodeSchema({ ...baseContext, nestedPath: [0], value: { type: "summon" } });
  const behaviors = summon.schema.fields.find((field) => field.fieldName === "behaviors");
  const behaviorType = behaviors.arrayItem.fields.find((field) => field.fieldName === "behavior_type");
  const priority = behaviors.arrayItem.fields.find((field) => field.fieldName === "priority");
  const triggerEvents = behaviors.arrayItem.fields.find((field) => field.fieldName === "trigger_events");
  assert.equal(behaviors.arrayItem.valueType, "object");
  assert.equal(behaviorType.valueType, "string");
  assert.equal(behaviorType.required, true);
  assert.equal(priority.valueType, "int");
  assert.equal(triggerEvents.arrayItem.valueType, "string");

  const tags = summon.schema.fields.find((field) => field.fieldName === "tags");
  assert.deepEqual(tags.arrayItem, { valueType: "string" });
});

test("shared contract adapter rejects array fields without contract item semantics", () => {
  const incomplete = structuredClone(contract);
  delete incomplete.nodes.summon.fields.find((field) => field.name === "behaviors").items;
  assert.throws(
    () => createSkillNodeContractRegistryAdapter(incomplete),
    /summon\.behaviors is missing items/,
  );
});

function violatesMappedConstraint(constraint, value) {
  if (constraint.operator === "non_empty_array") return !Array.isArray(value) || value.length === 0;
  if (constraint.operator === "offset_pair_integers") {
    return !Array.isArray(value) || value.some((offset) =>
      !Array.isArray(offset) || offset.length !== 2 || offset.some((coordinate) => !Number.isInteger(coordinate)));
  }
  throw new Error(`Unsupported test constraint: ${String(constraint.operator)}`);
}
