import assert from "node:assert/strict";
import test from "node:test";
import { buildTableRuntimeDeps } from "../src/table/table-runtime-deps.mjs";

test("buildTableRuntimeDeps keeps multi-select options from full collection rows even when the view is filtered", () => {
  const visibleRows = [
    { id: "1", tags: ["empower"] },
  ];
  const allRows = [
    ...visibleRows,
    { id: "2", tags: ["fire"] },
    { id: "3", tags: ["support"] },
  ];

  const runtime = buildTableRuntimeDeps({
    visibleFields: ["tags"],
    rows: visibleRows,
    optionRows: allRows,
    sourcePath: "data/skills.json",
    collectionPath: "$",
    displayTypes: { tags: "Multi-select" },
    fieldViewConfigs: {},
    relationConfigs: {},
    relationOptions: {},
  });

  assert.deepEqual(
    runtime.fieldOptions.tags.options.map((option) => option.value),
    ["empower", "fire", "support"],
  );
});
