import assert from "node:assert/strict";
import test from "node:test";
import { buildTableColumnModelsSignature } from "../src/table/table-column-signatures.mjs";

test("buildTableColumnModelsSignature stays stable when runtime refs churn without changing compiled column meaning", () => {
  const base = {
    visibleFields: ["title", "target_id", "payload"],
    rows: [{ title: "Fireball", target_id: "enemy_a", payload: { damage: 10 } }],
    nestedFieldSet: new Set(["payload"]),
    displayTypes: { title: "Text" },
    wrappedFields: new Set(["title"]),
    detectedTitleField: "title",
    primaryKeyField: null,
    backlinkColumns: [],
    relationOptionsByField: {
      target_id: [{ value: "enemy_a", label: "Enemy A", description: "boss" }],
    },
    relationConfigByField: {
      target_id: {
        targetFile: "data/enemies.json",
        targetCollection: "$",
        targetKey: "id",
        mode: "single",
        allowMissing: false,
        titleFields: ["name"],
      },
    },
    fieldOptions: {},
    selectOptions: {},
    widths: { title: 240, target_id: 180, payload: 260 },
    textEditable: false,
  };

  const first = buildTableColumnModelsSignature(base);
  const second = buildTableColumnModelsSignature({
    ...base,
    rows: [{ title: "Fireball", target_id: "enemy_a", payload: { damage: 10 } }],
    relationOptionsByField: {
      target_id: [{ value: "enemy_a", label: "Enemy A", description: "boss" }],
    },
    widths: { title: 240, target_id: 180, payload: 260 },
  });

  assert.equal(second, first);
});

test("buildTableColumnModelsSignature changes when compiled column output should change", () => {
  const base = {
    visibleFields: ["title", "target_id"],
    rows: [{ title: "Fireball", target_id: "enemy_a" }],
    nestedFieldSet: new Set(),
    displayTypes: { title: "Text" },
    wrappedFields: new Set(),
    detectedTitleField: "title",
    primaryKeyField: null,
    backlinkColumns: [],
    relationOptionsByField: {
      target_id: [{ value: "enemy_a", label: "Enemy A", description: "boss" }],
    },
    relationConfigByField: {
      target_id: {
        targetFile: "data/enemies.json",
        targetCollection: "$",
        targetKey: "id",
        mode: "single",
        allowMissing: false,
        titleFields: ["name"],
      },
    },
    fieldOptions: {},
    selectOptions: {},
    widths: { title: 240, target_id: 180 },
    textEditable: false,
  };

  const first = buildTableColumnModelsSignature(base);
  const wrapped = buildTableColumnModelsSignature({ ...base, wrappedFields: new Set(["title"]) });
  const resized = buildTableColumnModelsSignature({ ...base, widths: { title: 260, target_id: 180 } });
  const primaryKeyChanged = buildTableColumnModelsSignature({ ...base, primaryKeyField: "target_id" });
  const relabeled = buildTableColumnModelsSignature({
    ...base,
    relationOptionsByField: {
      target_id: [{ value: "enemy_a", label: "Boss A", description: "boss" }],
    },
  });

  assert.notEqual(wrapped, first);
  assert.notEqual(resized, first);
  assert.notEqual(primaryKeyChanged, first);
  assert.notEqual(relabeled, first);
});

test("buildTableColumnModelsSignature changes when table text editing changes text cell rendering", () => {
  const base = {
    visibleFields: ["title", "description", "target_id"],
    rows: [{ title: "Fireball", description: "Burns", target_id: "enemy_a" }],
    nestedFieldSet: new Set(),
    displayTypes: { title: "Text", description: "Text", target_id: "Relation" },
    wrappedFields: new Set(),
    detectedTitleField: "title",
    primaryKeyField: null,
    backlinkColumns: [],
    relationOptionsByField: {
      target_id: [{ value: "enemy_a", label: "Enemy A", description: "boss" }],
    },
    relationConfigByField: {
      target_id: {
        targetFile: "data/enemies.json",
        targetCollection: "$",
        targetKey: "id",
        mode: "single",
        allowMissing: false,
        titleFields: ["name"],
      },
    },
    fieldOptions: {},
    selectOptions: {},
    widths: { title: 240, description: 260, target_id: 180 },
    textEditable: false,
  };

  const readonly = buildTableColumnModelsSignature(base);
  const editable = buildTableColumnModelsSignature({ ...base, textEditable: true });

  assert.notEqual(editable, readonly);
});
