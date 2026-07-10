import test from "node:test";
import assert from "node:assert/strict";
import { resolveNestedNodeSchema } from "../src/detail/node-schema-registry.mjs";

test("resolves fixed object schema for classes.starting_equipments", () => {
  const result = resolveNestedNodeSchema({
    sourcePath: "data/classes.json",
    collectionPath: "$",
    rootField: "starting_equipments",
    nestedPath: [],
    value: {
      main_hand: "base_greatsword",
      off_hand: "",
      helm: "",
      chest: "base_chainmail",
      gloves: "",
      boots: "",
      ring: "",
      amulet: "",
    },
  });

  assert.equal(result.kind, "supported");
  assert.equal(result.schema.title, "starting_equipments");
  assert.deepEqual(result.schema.fields.map((field) => field.fieldName), [
    "main_hand",
    "off_hand",
    "helm",
    "chest",
    "gloves",
    "boots",
    "ring",
    "amulet",
  ]);
});

test("resolves discriminated rune params schema by effect_type", () => {
  const result = resolveNestedNodeSchema({
    sourcePath: "data/runes.json",
    collectionPath: "$",
    rootField: "effects",
    nestedPath: [0, "params"],
    value: {
      effect_type: "trigger_on_cast",
      energy_per_event: 100,
      note: "施放被辅助的伤害技能时积累1个冰刺",
      skill_filter: "damage",
      threshold: 100,
      trigger_effect: {
        amount: 1,
        counter_id: "frost_spike",
        max: 6,
        type: "counter_accumulate",
      },
    },
  });

  assert.equal(result.kind, "supported");
  assert.equal(result.schema.title, "trigger_on_cast.params");
  assert.deepEqual(result.schema.fields.map((field) => field.fieldName), [
    "energy_per_event",
    "note",
    "skill_filter",
    "threshold",
    "trigger_effect",
  ]);
});

test("resolves discriminated recursive skills node schema by type", () => {
  const result = resolveNestedNodeSchema({
    sourcePath: "data/skills.json",
    collectionPath: "skills",
    rootField: "nodes",
    nestedPath: [0],
    value: {
      condition_type: "target_health_below",
      else_nodes: [],
      then_nodes: [{ type: "damage", base_damage: 25, damage_type: "physical" }],
      threshold: 0.3,
      type: "condition",
    },
  });

  assert.equal(result.kind, "supported");
  assert.equal(result.schema.title, "skills.condition");
  assert.deepEqual(result.schema.fields.map((field) => field.fieldName), [
    "condition_type",
    "threshold",
    "then_nodes",
    "else_nodes",
  ]);
});

test("resolves recursive child skills node path under then_nodes", () => {
  const result = resolveNestedNodeSchema({
    sourcePath: "data/skills.json",
    collectionPath: "skills",
    rootField: "nodes",
    nestedPath: [0, "then_nodes", 0],
    value: {
      type: "damage",
      base_damage: 25,
      damage_type: "physical",
    },
  });

  assert.equal(result.kind, "supported");
  assert.equal(result.currentDiscriminator, "damage");
  assert.deepEqual(result.schema.fields.map((field) => field.fieldName), [
    "base_damage",
    "damage_type",
    "element",
    "scaling_type",
    "sp_ratio",
    "ad_ratio",
    "hit_count",
    "damage_range_max",
    "damage_range_min",
    "runtime_todo",
  ]);
});

test("resolves rune params schema from parent effect context", () => {
  const result = resolveNestedNodeSchema({
    sourcePath: "data/runes.json",
    collectionPath: "$",
    rootField: "effects",
    nestedPath: [0, "params"],
    value: {
      energy_per_event: 100,
      note: "ctx",
      skill_filter: "damage",
    },
    contextValue: {
      effect_type: "trigger_on_cast",
    },
  });

  assert.equal(result.kind, "supported");
  assert.equal(result.currentDiscriminator, "trigger_on_cast");
  assert.equal(result.canSwitchDiscriminator, false);
  assert.deepEqual(result.schema.fields.map((field) => field.fieldName), [
    "energy_per_event",
    "note",
    "skill_filter",
    "threshold",
    "trigger_effect",
  ]);
});

test("returns unsupported result for unregistered nested object path", () => {
  const result = resolveNestedNodeSchema({
    sourcePath: "data/unknown.json",
    collectionPath: "unknown",
    rootField: "mystery",
    nestedPath: [],
    value: { a: 1 },
  });

  assert.equal(result.kind, "unsupported");
  assert.match(result.reason, /No registered schema/i);
});
