import assert from "node:assert/strict";
import test from "node:test";
import { createNestedSchemaCapabilityResolver } from "../src/detail/nested-schema-capability.mjs";

const binding = {
  id: "project-nested",
  match: { dataSourceId: "content", path: "items.json", collection: "items", rootField: "rule", nestedPath: [] },
  definition: {
    schema: {
      nodeKind: "object",
      title: "rule",
      fields: [{ fieldName: "amount", displayType: "Number", defaultValue: 0 }],
      defaultValue: { amount: 0 },
      allowUnknownFields: false,
      presentation: null,
    },
  },
};

test("project nested schema resolver requires the full virtual document identity", () => {
  const resolver = createNestedSchemaCapabilityResolver([binding]);
  const supported = resolver.resolve({ dataSourceId: "content", path: "items.json", collectionPath: "items", rootField: "rule", nestedPath: [], value: { amount: 2 } });
  assert.equal(supported.kind, "supported");
  assert.equal(supported.schema.title, "rule");
  assert.equal(resolver.resolve({ dataSourceId: "data", path: "items.json", collectionPath: "items", rootField: "rule", nestedPath: [], value: {} }).kind, "unsupported");
  assert.equal(resolver.resolve({ dataSourceId: "content", path: "items.json", collectionPath: "items", rootField: "other", nestedPath: [], value: {} }).kind, "unsupported");
});
