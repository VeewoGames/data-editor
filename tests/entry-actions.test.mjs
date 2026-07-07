import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentModel } from "../src/document-model.mjs";
import { resolveEntryActionRow, validateEntryActionTarget } from "../src/entry-actions.mjs";
import { ensurePersistentEntryIds } from "../src/model/persistent-entry-id.mjs";

test("resolveEntryActionRow prefers stable rowId over stale sourceRowIndex", () => {
  const model = buildDocumentModel({
    skills: [
      { skill_id: "skill_alpha", skill_name: "Alpha" },
      { skill_id: "skill_beta", skill_name: "Beta" },
    ],
  }, "json", "memory://skills.json");
  ensurePersistentEntryIds(model);
  const betaRowId = model.root.skills[1].__entry_id;

  const resolved = resolveEntryActionRow(model, "skills", 0, betaRowId);

  assert.equal(resolved.sourceRowIndex, 1);
  assert.equal(resolved.row.skill_id, "skill_beta");
  assert.equal(resolved.previousRow.skill_id, "skill_alpha");
  assert.equal(resolved.nextRow, null);
});

test("validateEntryActionTarget requires an exact file and collection pair", () => {
  const action = {
    id: "recheck",
    targets: [
      { file: "data/skills.json", collection: "skills" },
      { file: "data/traits.json", collection: "traits" },
    ],
  };

  assert.doesNotThrow(() => validateEntryActionTarget(action, "data/traits.json", "traits"));
  assert.throws(
    () => validateEntryActionTarget(action, "data/traits.json", "skills"),
    /does not allow target/i,
  );
});
