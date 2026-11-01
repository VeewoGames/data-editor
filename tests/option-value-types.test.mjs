import test from "node:test";
import assert from "node:assert/strict";
import { normalizeViewConfig } from "../src/view-config.mjs";
import normalizeFetchedViewConfig from "../src/view-config-client.mjs";
import { buildMultiSelectFieldConfig, buildOptionConfigFromOptions, buildSchemaOptionViews, resolveOptionDataValue } from "../src/multiselect-config.mjs";

test("numeric option metadata survives server, JSON, client and an empty source collection", () => {
  const options = buildOptionConfigFromOptions(buildMultiSelectFieldConfig([0, -2.5, 180]).options);
  const config = normalizeFetchedViewConfig(JSON.parse(JSON.stringify(normalizeViewConfig({ fields: {
    "data/options.json:records:values": { multiSelectOptions: options, selectOptions: options },
  } }))));
  const field = config.fields["data/options.json:records:values"];
  for (const name of ["multiSelectOptions", "selectOptions"]) assert.equal(field[name]["0"].dataValue, 0);
  const reopened = buildMultiSelectFieldConfig([], field);
  assert.equal(resolveOptionDataValue("180", reopened.options), 180);
  assert.equal(resolveOptionDataValue("-2.5", reopened.options), -2.5);
});

test("option metadata accepts raw strings but rejects mismatched keys and non-scalars", () => {
  for (const normalize of [normalizeViewConfig, normalizeFetchedViewConfig]) {
    const config = normalize({ fields: { field: { multiSelectOptions: {
      "001": { dataValue: "001" }, bad: { dataValue: { value: 1 } }, "180": { dataValue: 90 },
    } } } });
    assert.equal(config.fields.field.multiSelectOptions["001"].dataValue, "001");
    assert.equal(config.fields.field.multiSelectOptions.bad.dataValue, undefined);
    assert.equal(config.fields.field.multiSelectOptions["180"].dataValue, undefined);
  }
});

test("schema options retain numeric authority when empty and disable conflicting types", () => {
  const options = buildSchemaOptionViews([{ value: 0, label: "Zero" }, { value: 180, label: "Number" }, { value: "180", label: "String" }]);
  assert.equal(resolveOptionDataValue("0", options), 0);
  assert.equal(resolveOptionDataValue("180", options), undefined);
  assert.equal(options.find(option => option.value === "180").dataValueAmbiguous, true);
});

test("ambiguous runtime values cannot be promoted to persisted type metadata", () => {
  const config = buildOptionConfigFromOptions([{ value: "180", dataValue: 180, dataValueAmbiguous: true, label: "Conflict", color: null }]);
  assert.equal(config["180"].dataValue, undefined);
});
