import assert from "node:assert/strict";
import test from "node:test";
import { resolveEntryActionDocumentTarget } from "../src/entry-action-document-target.mjs";

const viewConfig = {
  primaryKeys: { "data/skills.json:skills": "skill_id" },
  documentFiles: { "data/skills.json": { docRoot: "项目文档/开发/技能" } },
};

test("Markdown automation derives its document path from the collection primary key and document root", () => {
  assert.deepEqual(resolveEntryActionDocumentTarget({
    viewConfig,
    file: "data/skills.json",
    collection: "skills",
    row: { skill_id: "skill_frost_nova", dev_doc: "legacy/path.md" },
  }), {
    primaryKeyField: "skill_id",
    documentRoot: "项目文档/开发/技能",
    sourceValue: "skill_frost_nova",
    path: "项目文档/开发/技能/skill_frost_nova.md",
  });
});

test("Markdown automation requires the same primary key and document root configuration as linked documents", () => {
  assert.throws(() => resolveEntryActionDocumentTarget({
    viewConfig: { primaryKeys: {}, documentFiles: {} },
    file: "data/skills.json",
    collection: "skills",
    row: { skill_id: "skill_frost_nova" },
  }), { code: "ENTRY_ACTION_DOCUMENT_TARGET_NOT_CONFIGURED" });
});
