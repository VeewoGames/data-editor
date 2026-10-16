import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import ts from "typescript";
import { checkboxCheckedStyle, normalizeCheckboxPresentation } from "../src/model/checkbox-presentation.mjs";
import { assertValidFieldPresentations, normalizeViewConfig } from "../src/view-config.mjs";
import normalizeFetchedViewConfig from "../src/view-config-client.mjs";

const checkbox = { checkedColor: "#16a34a", checkedOpacity: 0.6 };
const config = (presentation) => ({ fields: { "items.json:$:enabled": { type: "Checkbox", presentation } } });
const presentationOf = (value) => value.fields["items.json:$:enabled"].presentation;

test("checkbox presentation survives both config boundaries, including checkbox-only and opacity zero", () => {
  for (const normalize of [normalizeViewConfig, normalizeFetchedViewConfig]) {
    assert.deepEqual(presentationOf(normalize(config({ checkbox }))), { checkbox });
    assert.deepEqual(presentationOf(normalize(config({ label: " Enabled ", description: " Toggle ", checkbox }))), {
      label: "Enabled", description: "Toggle", checkbox,
    });
    assert.deepEqual(presentationOf(normalize(config({ checkbox: { checkedOpacity: 0 } }))), { checkbox: { checkedOpacity: 0 } });
    assert.deepEqual(presentationOf(normalize(config({ label: "Enabled", checkbox: { checkedColor: "var(--anything)", checkedOpacity: Infinity } }))), { label: "Enabled" });
  }
  assert.doesNotThrow(() => assertValidFieldPresentations(config({ checkbox })));
  for (const checkedColor of ["#abc", "#abcd", "#ABCDEF", "#12345678"]) {
    assert.doesNotThrow(() => assertValidFieldPresentations(config({ checkbox: { checkedColor } })));
  }
});

test("write validation rejects CSS expressions, invalid hex, opacity coercion and unknown checkbox keys", () => {
  const invalid = [
    null, [], {}, { checkedColor: "green" }, { checkedColor: "var(--green)" },
    { checkedColor: "#12" }, { checkedColor: "#gggggg" }, { checkedColor: " #16a34a " },
    { checkedOpacity: -0.1 }, { checkedOpacity: 1.1 }, { checkedOpacity: NaN },
    { checkedOpacity: Infinity }, { checkedOpacity: "0.6" },
    { checkedColor: "#16a34a", background: "red" },
    { checkedColor: "#16a34a", checkedOpacity: null },
  ];
  for (const value of invalid) {
    assert.throws(() => assertValidFieldPresentations(config({ checkbox: value })), {
      code: "VIEW_CONFIG_FIELD_PRESENTATION_INVALID", status: 400,
    });
  }
});

test("checked style is opt-in and does not change unchecked or default checkboxes", () => {
  assert.equal(checkboxCheckedStyle(true), undefined);
  assert.equal(checkboxCheckedStyle(true, { label: "Enabled" }), undefined);
  assert.equal(checkboxCheckedStyle(false, { checkbox }), undefined);
  assert.equal(checkboxCheckedStyle(true, { checkbox: { checkedColor: "url(example)" } }), undefined);
  assert.deepEqual(checkboxCheckedStyle(true, { checkbox }), { accentColor: "#16a34a", opacity: 0.6 });
  assert.deepEqual(checkboxCheckedStyle(true, { checkbox: { checkedOpacity: 0 } }), { opacity: 0 });
  assert.equal(normalizeCheckboxPresentation(null), undefined);
});

// Execute the actual raw-checkbox render branches without booting a shared service.
async function loadCheckboxBranch(file, start, end, parameters, setup = "") {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, "raw checkbox render branch must exist");
  const compiled = ts.transpileModule(`function render(${parameters}) { ${setup}\n${source.slice(from, to)} }`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("React", "checkboxCheckedStyle", `${compiled}; return render;`)(React, checkboxCheckedStyle);
}

function checkboxInput(element) {
  if (!element || typeof element !== "object") return undefined;
  if (element.type === "input" && element.props.type === "checkbox") return element;
  for (const child of React.Children.toArray(element.props?.children)) {
    const found = checkboxInput(child);
    if (found) return found;
  }
  return undefined;
}

test("table and detail raw checkbox branches share styling and remain editable", async () => {
  const table = await loadCheckboxBranch("../src/table/CellRenderer.tsx", '  if (displayType === "Checkbox") {', '  if (displayType === "Multi-select"', "value, presentation, onEdit", 'const displayType = "Checkbox"; const issueNode = null;');
  const detail = await loadCheckboxBranch("../src/detail/DetailPanel.tsx", '  if (props.displayType === "Checkbox") {', '  if (props.displayType === "Document") {', "props");
  for (const checked of [true, false]) {
    for (const presentation of [undefined, { checkbox }]) {
      let tableEdit;
      let detailEdit;
      const inputs = [
        checkboxInput(table(checked, presentation, (value) => { tableEdit = value; })),
        checkboxInput(detail({ displayType: "Checkbox", value: checked, presentation, fieldName: "enabled", onEditField: (field, value) => { detailEdit = { field, value }; } })),
      ];
      for (const input of inputs) {
        assert.ok(input);
        assert.equal(input.props.checked, checked);
        assert.deepEqual(input.props.style, checked && presentation ? { accentColor: "#16a34a", opacity: 0.6 } : undefined);
        assert.equal(input.props.disabled, undefined);
        assert.equal(input.props.readOnly, undefined);
        input.props.onChange({ target: { checked: !checked } });
      }
      assert.equal(tableEdit, !checked);
      assert.deepEqual(detailEdit, { field: "enabled", value: !checked });
    }
  }
});
