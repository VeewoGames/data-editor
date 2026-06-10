import assert from "node:assert/strict";
import test from "node:test";
import { buildTableColumnModels, getColumnModelDisplayType } from "../src/table/table-column-models.mjs";

test("buildTableColumnModels compiles per-column descriptors from runtime deps and field config", () => {
  const models = buildTableColumnModels({
    visibleFields: ["title", "tags", "target_id", "backlinks", "payload"],
    rows: [{
      title: "Fireball",
      tags: ["fire"],
      target_id: "enemy_a",
      payload: { nested: true },
    }],
    nestedFieldSet: new Set(["payload"]),
    displayTypes: {
      title: "Text",
      tags: "Multi-select",
    },
    wrappedFields: new Set(["title"]),
    detectedTitleField: "title",
    backlinkColumns: [{
      backlinkKey: "target<-source",
      fieldName: "backlinks",
      sourceRelation: "target_id",
      targetKey: "id",
      status: "ready",
      message: "",
    }],
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
    fieldOptions: {
      tags: {
        options: [{ value: "fire", label: "fire", color: null }],
        optionMap: { fire: { value: "fire", label: "fire", color: null } },
      },
    },
    selectOptions: {},
    getColumnWidth: (fieldName) => ({ title: 240, tags: 180, target_id: 200, backlinks: 220, payload: 260 })[fieldName] ?? 180,
  });

  const title = models.find((model) => model.fieldName === "title");
  const relation = models.find((model) => model.fieldName === "target_id");
  const backlink = models.find((model) => model.fieldName === "backlinks");
  const nested = models.find((model) => model.fieldName === "payload");

  assert.ok(title);
  assert.equal(title.displayType, "Text");
  assert.equal(title.isTitle, true);
  assert.equal(title.wrapped, true);
  assert.equal(title.width, 240);

  assert.ok(relation);
  assert.equal(relation.displayType, "Relation");
  assert.equal(relation.roleKind, "relation");
  assert.equal(relation.relationConfigured, true);
  assert.deepEqual(relation.relationOptions.map((option) => option.value), ["enemy_a"]);

  assert.ok(backlink);
  assert.equal(backlink.displayType, "Backlink");
  assert.equal(backlink.roleKind, "backlink");
  assert.equal(backlink.allowTypeChange, false);

  assert.ok(nested);
  assert.equal(nested.displayType, "Nested");
  assert.equal(nested.isNested, true);
  assert.equal(nested.allowTypeChange, false);

  assert.equal(getColumnModelDisplayType("backlinks", models), "Backlink");
  assert.equal(getColumnModelDisplayType("missing", models), null);
});

test("buildTableColumnModels reuses previous column objects when per-field shape is unchanged", () => {
  const input = {
    visibleFields: ["title", "status"],
    rows: [{ title: "Alpha", status: "ready" }],
    nestedFieldSet: new Set(),
    displayTypes: { title: "Text", status: "Text" },
    wrappedFields: new Set(["title"]),
    detectedTitleField: "title",
    backlinkColumns: [],
    relationOptionsByField: {},
    relationConfigByField: {},
    fieldOptions: {},
    selectOptions: {},
    getColumnWidth: (fieldName) => ({ title: 240, status: 180 })[fieldName] ?? 180,
  };

  const first = buildTableColumnModels(input);
  const previousByField = Object.fromEntries(first.map((model) => [model.fieldName, model]));
  const reordered = buildTableColumnModels({
    ...input,
    visibleFields: ["status", "title"],
    previousByField,
  });

  assert.equal(reordered[0], previousByField.status);
  assert.equal(reordered[1], previousByField.title);

  const resized = buildTableColumnModels({
    ...input,
    previousByField,
    getColumnWidth: (fieldName) => ({ title: 260, status: 180 })[fieldName] ?? 180,
  });

  assert.notEqual(resized.find((model) => model.fieldName === "title"), previousByField.title);
  assert.equal(resized.find((model) => model.fieldName === "status"), previousByField.status);
});
