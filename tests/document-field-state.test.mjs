import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSelectedDocumentFields,
  findPreferredActiveDocumentField,
  mergeDetailFieldOrder,
  shouldOpenDetailDocumentPanel,
} from "../src/model/document-field-state.mjs";

test("buildSelectedDocumentFields resolves configured document fields from the current row primary key", () => {
  const result = buildSelectedDocumentFields({
    sourcePath: "data/skills.json",
    collectionPath: "$",
    row: { skill_id: "skill_fireball", name: "Fireball" },
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
    },
  });

  assert.deepEqual(result.map((entry) => ({ fieldName: entry.fieldName, documentId: entry.documentId, label: entry.label })), [
    { fieldName: "doc_id", documentId: "skill_fireball", label: "Fireball Guide" },
    { fieldName: "extra_doc", documentId: "skill_fireball", label: "Fireball Guide" },
  ]);
});

test("mergeDetailFieldOrder appends sparse document fields after row keys", () => {
  const result = mergeDetailFieldOrder(
    { id: "skill_fireball", name: "Fireball" },
    { id: "Text", name: "Text", doc_id: "Document" },
  );

  assert.deepEqual(result, ["id", "name", "doc_id"]);
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
