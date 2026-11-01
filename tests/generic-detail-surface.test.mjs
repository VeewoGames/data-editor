import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/detail/DetailPanel.tsx", import.meta.url), "utf8");
const titleSource = await readFile(new URL("../src/model/titleField.ts", import.meta.url), "utf8");
const titleFunctions = titleSource.slice(titleSource.indexOf("export function findTitleField")).replaceAll("export function", "function");
const summaries = source.slice(source.indexOf("function getNestedItemSummary("), source.indexOf("function makeEmptyNestedItem("));
const javascript = ts.transpileModule(`${titleFunctions}\n${summaries}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const { getNestedItemSummary, getNestedItemMeta } = new Function(`${javascript}; return { getNestedItemSummary, getNestedItemMeta };`)();

test("generic nested cards use the shared title convention without business field precedence", () => {
  const record = { code: "customer-42", category: "business category", effect_type: "business effect", id: "business id", keyword_id: "business keyword" };
  assert.equal(getNestedItemSummary(record, 0), "customer-42");
  assert.equal(getNestedItemSummary({ ...record, name: "Customer label" }, 0), "Customer label");
  assert.equal(getNestedItemSummary({ reference_name: "Shared title", ...record }, 0), "Shared title");
});

test("generic nested metadata follows record keys rather than named business values", () => {
  assert.equal(getNestedItemMeta({ code: "42", label: "Customer", active: true, category: "secret", timing: "later", name_en: "secret" }), "code / label / active");
  assert.equal(getNestedItemSummary(null, 2), "Item 3");
  assert.equal(getNestedItemMeta(null), "");
});
