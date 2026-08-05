import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSelectedDocumentFields,
  findPreferredActiveDocumentField,
  mergeDetailFieldOrder,
  shouldOpenDetailDocumentPanel,
} from "../src/model/document-field-state.mjs";

test("buildSelectedDocumentFields resolves each configured field from its own row value", () => {
  const result = buildSelectedDocumentFields({
    sourcePath: "data/skills.json",
    collectionPath: "$",
    row: { skill_id: "skill_fireball", name: "Fireball", doc_id: "skill_fireball", extra_doc: "skill_frostbolt" },
    primaryKeyField: "skill_id",
    displayTypes: {
      skill_id: "Text",
      name: "Text",
      doc_id: "Document",
      extra_doc: "Document",
    },
    documentFieldConfigs: {
      "data/skills.json:$:doc_id": { enabled: true },
      "data/skills.json:$:extra_doc": { enabled: true },
    },
    documentIndexEntries: {
      skill_fireball: {
        status: "resolved",
        id: "skill_fireball",
        relativePath: "skill_fireball.md",
        title: "Fireball Guide",
      },
      skill_frostbolt: {
        status: "resolved",
        id: "skill_frostbolt",
        relativePath: "skill_frostbolt.md",
        title: "Frostbolt Guide",
      },
    },
  });

  assert.deepEqual(result.map((entry) => ({ fieldName: entry.fieldName, documentId: entry.documentId, label: entry.label })), [
    { fieldName: "doc_id", documentId: "skill_fireball", label: "Fireball Guide" },
    { fieldName: "extra_doc", documentId: "skill_frostbolt", label: "Frostbolt Guide" },
  ]);
});

test("buildSelectedDocumentFields resolves a project-relative Markdown path through the configured document root", () => {
  const result = buildSelectedDocumentFields({
    sourcePath: "data/skills.json",
    collectionPath: "skills",
    row: { dev_doc: "项目文档/开发/技能/skill_fireball.md" },
    primaryKeyField: "skill_id",
    displayTypes: { dev_doc: "Document" },
    documentFieldConfigs: { "data/skills.json:skills:dev_doc": { enabled: true } },
    documentRoot: "项目文档/开发/技能",
    documentIndexEntries: {
      skill_fireball: { status: "resolved", id: "skill_fireball", relativePath: "skill_fireball.md", title: "Fireball Guide" },
    },
  });

  assert.deepEqual(result.map((entry) => ({ documentId: entry.documentId, label: entry.label })), [
    { documentId: "skill_fireball", label: "Fireball Guide" },
  ]);
});

test("mergeDetailFieldOrder appends sparse document fields after row keys", () => {
  const result = mergeDetailFieldOrder(
    { id: "skill_fireball", name: "Fireball" },
    ["id", "name"],
    { id: "Text", name: "Text", doc_id: "Document" },
  );

  assert.deepEqual(result, ["id", "name", "doc_id"]);
});

test("mergeDetailFieldOrder appends sparse collection fields even when the current row omits them", () => {
  const result = mergeDetailFieldOrder(
    { skill_id: "skill_fireball", skill_name: "Fireball" },
    ["skill_id", "skill_name", "nodes"],
    { skill_id: "Text", skill_name: "Text" },
  );

  assert.deepEqual(result, ["skill_id", "skill_name", "nodes"]);
});

test("findPreferredActiveDocumentField prefers a linked field when the current field is empty", () => {
  const result = findPreferredActiveDocumentField({
    selectedDocumentFields: [
      { fieldName: "doc_id", documentId: "", label: "未关联文档" },
      { fieldName: "extra_doc", documentId: "fireball", label: "Fireball Guide" },
    ],
    activeFieldName: "doc_id",
    preferLinkedField: true,
  });

  assert.equal(result?.fieldName, "extra_doc");
});

test("shouldOpenDetailDocumentPanel only restores open state when detail is visible and a linked document exists", () => {
  assert.equal(shouldOpenDetailDocumentPanel({
    detailOpen: true,
    panelPreferenceOpen: true,
    selectedDocumentFields: [
      { fieldName: "doc_id", documentId: "", label: "未关联文档" },
      { fieldName: "extra_doc", documentId: "", label: "未关联文档" },
    ],
  }), false);

  assert.equal(shouldOpenDetailDocumentPanel({
    detailOpen: false,
    panelPreferenceOpen: true,
    selectedDocumentFields: [
      { fieldName: "doc_id", documentId: "fireball", label: "Fireball Guide" },
    ],
  }), false);

  assert.equal(shouldOpenDetailDocumentPanel({
    detailOpen: true,
    panelPreferenceOpen: true,
    selectedDocumentFields: [
      { fieldName: "doc_id", documentId: "", label: "未关联文档" },
      { fieldName: "extra_doc", documentId: "fireball", label: "Fireball Guide" },
    ],
  }), true);
});
