import assert from "node:assert/strict";
import test from "node:test";
import { computeFieldMenuCapabilities } from "../src/table/field-capabilities.mjs";

test("text field capabilities allow title primary key and relation when field is plain text", () => {
  const capabilities = computeFieldMenuCapabilities({
    baseDisplayType: "Text",
    roleKind: "normal",
  });

  assert.equal(capabilities.canChangeType, true);
  assert.equal(capabilities.canBeTitle, true);
  assert.equal(capabilities.canBePrimaryKey, true);
  assert.equal(capabilities.canConfigureRelation, true);
  assert.equal(capabilities.canConfigureDocument, true);
  assert.deepEqual(capabilities.allowedTypeTargets, ["Text", "Select", "Document"]);
});

test("title or primary key text field can no longer configure relation", () => {
  const titleCapabilities = computeFieldMenuCapabilities({
    baseDisplayType: "Text",
    roleKind: "normal",
    isTitle: true,
  });
  const primaryKeyCapabilities = computeFieldMenuCapabilities({
    baseDisplayType: "Text",
    roleKind: "normal",
    isPrimaryKey: true,
  });

  assert.equal(titleCapabilities.canConfigureRelation, false);
  assert.equal(primaryKeyCapabilities.canConfigureRelation, false);
});

test("select and document fields cannot become title, primary key, or relation", () => {
  const selectCapabilities = computeFieldMenuCapabilities({
    baseDisplayType: "Select",
    roleKind: "normal",
  });
  const documentCapabilities = computeFieldMenuCapabilities({
    baseDisplayType: "Document",
    roleKind: "normal",
  });

  assert.equal(selectCapabilities.canBeTitle, false);
  assert.equal(selectCapabilities.canBePrimaryKey, false);
  assert.equal(selectCapabilities.canConfigureRelation, false);
  assert.equal(selectCapabilities.canConfigureDocument, false);

  assert.equal(documentCapabilities.canBeTitle, false);
  assert.equal(documentCapabilities.canBePrimaryKey, false);
  assert.equal(documentCapabilities.canConfigureRelation, false);
  assert.equal(documentCapabilities.canConfigureDocument, true);
});

test("relation and backlink fields suppress structural menu capabilities", () => {
  const relationCapabilities = computeFieldMenuCapabilities({
    baseDisplayType: "Text",
    roleKind: "relation",
    relationConfigured: true,
  });
  const backlinkCapabilities = computeFieldMenuCapabilities({
    baseDisplayType: "Text",
    roleKind: "backlink",
    isBacklink: true,
  });

  assert.deepEqual(relationCapabilities.allowedTypeTargets, []);
  assert.equal(relationCapabilities.canChangeType, false);
  assert.equal(relationCapabilities.canBeTitle, false);
  assert.equal(relationCapabilities.canBePrimaryKey, false);
  assert.equal(relationCapabilities.canConfigureRelation, false);
  assert.equal(relationCapabilities.canConfigureDocument, false);

  assert.equal(backlinkCapabilities.canChangeType, false);
  assert.equal(backlinkCapabilities.canBeTitle, false);
  assert.equal(backlinkCapabilities.canBePrimaryKey, false);
  assert.equal(backlinkCapabilities.canConfigureRelation, false);
  assert.equal(backlinkCapabilities.canConfigureDocument, false);
});
