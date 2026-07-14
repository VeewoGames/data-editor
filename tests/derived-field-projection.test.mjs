import assert from "node:assert/strict";
import test from "node:test";
import {
  derivedFieldNames,
  discoverProjectedFields,
  projectDerivedFields,
} from "../src/view/derived-field-projection.mjs";
import { runView } from "../src/view/view-engine.mjs";

const context = { sourcePath: "data/content/skills.json", collectionPath: "skills" };
const skill = {
  skill_id: "skill_test",
  range_type_show: "legacy",
  range_value_show: 99,
  nodes: [
    {
      type: "targeting",
      selection: { type: "entity", distance: 4, relations: ["enemy"] },
      area: { shape: "cone", size: 2 },
      affects: { relations: ["enemy", "neutral"] },
    },
    { type: "sequence", children: [{ type: "movement", mode: "push" }, { type: "movement", mode: "push" }] },
  ],
};

test("DerivedFieldProjection adds six virtual fields without mutating the source skill", () => {
  const projected = projectDerivedFields(skill, context);
  assert.notEqual(projected, skill);
  assert.equal(projected["@selection_type"], "entity");
  assert.equal(projected["@selection_distance"], 4);
  assert.deepEqual(projected["@selection_relations"], ["enemy"]);
  assert.equal(projected["@area_shape"], "cone");
  assert.deepEqual(projected["@affects_relations"], ["enemy", "neutral"]);
  assert.deepEqual(projected["@movement_mode"], ["push"]);
  assert.equal(Object.hasOwn(skill, "@selection_type"), false);
});

test("DerivedFieldProjection inherits entity selection affects with or without area and preserves explicit override", () => {
  const cases = [
    {
      targeting: { type: "targeting", selection: { type: "entity", relations: ["enemy"], entity_types: ["character"] } },
      expected: ["enemy"],
    },
    {
      targeting: {
        type: "targeting",
        selection: { type: "entity", relations: ["ally"], entity_types: ["character"] },
        area: { shape: "circle", size: 1 },
      },
      expected: ["ally"],
    },
    {
      targeting: {
        type: "targeting",
        selection: { type: "entity", relations: ["enemy"], entity_types: ["character"] },
        affects: { relations: ["neutral"], entity_types: ["deployable"] },
      },
      expected: ["neutral"],
    },
  ];
  for (const { targeting, expected } of cases) {
    const projected = projectDerivedFields({ skill_id: "probe", nodes: [targeting] }, context);
    assert.deepEqual(projected["@affects_relations"], expected);
  }
});

test("field discovery removes legacy display fields and exposes virtual fields only for formal skills", () => {
  assert.deepEqual(
    discoverProjectedFields(["skill_id", "range_type_show", "range_value_show"], context),
    ["skill_id", ...derivedFieldNames],
  );
  assert.deepEqual(
    discoverProjectedFields(["range_type_show"], { sourcePath: "data/other.json", collectionPath: "$" }),
    ["range_type_show"],
  );
});

test("runView projects virtual fields before filters and sorting", () => {
  const rows = [
    { rowId: "far", sourceOrder: 0, row: skill },
    { rowId: "near", sourceOrder: 1, row: { ...skill, nodes: [{ ...skill.nodes[0], selection: { type: "entity", distance: 2, relations: ["ally"] } }] } },
  ];
  const result = runView({
    rows,
    query: "",
    filters: { topLevelRules: [{ kind: "rule", id: "enemy", field: "@selection_relations", operator: "contains", value: "enemy" }], advancedRoot: null },
    sorts: [{ id: "distance", field: "@selection_distance", direction: "asc" }],
    fieldTypes: { "@selection_relations": "Multi-select", "@selection_distance": "Number" },
    derivedFieldProjection: context,
  });
  assert.deepEqual(result.visibleRowIds, ["far"]);
  assert.equal(Object.hasOwn(skill, "@selection_distance"), false);
});
