import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { buildDocumentModel } from "../src/document-model.mjs";
import { entryActionHandoffPath, findActiveEntryActionRuns, matchesEntryActionIdentity, resolveEntryActionRow, validateEntryActionTarget } from "../src/entry-actions.mjs";
import { canonicalFileIdentity } from "../src/canonical-file-identity.mjs";
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

test("strict resolver rejects missing, absent and duplicate persistent entry ids without index fallback", () => {
  const model = buildDocumentModel({ skills: [{ __entry_id: "one", name: "One" }, { __entry_id: "two", name: "Two" }] }, "json", "memory://skills.json");
  assert.throws(() => resolveEntryActionRow(model, "skills", 0, null), (error) => error?.code === "ENTRY_ACTION_TARGET_MISSING");
  assert.throws(() => resolveEntryActionRow(model, "skills", 0, "none"), (error) => error?.code === "ENTRY_ACTION_TARGET_MISSING");
  model.root.skills[1].__entry_id = "one";
  assert.throws(() => resolveEntryActionRow(model, "skills", 0, "one"), (error) => error?.code === "ENTRY_ACTION_TARGET_ID_DUPLICATE");
});

test("latest-run identity never falls back to sourceRowIndex", () => {
  const handoff = { entry: { sourcePath: "data/items.json", collectionPath: "items", rowId: "entry-1", sourceRowIndex: 1 }, action: { id: "recheck" } };
  assert.equal(matchesEntryActionIdentity(handoff, { sourcePath: "data/items.json", collectionPath: "items", sourceRowIndex: 1, actionId: "recheck" }), false);
  assert.equal(matchesEntryActionIdentity(handoff, { sourcePath: "data/items.json", collectionPath: "items", rowId: "entry-1", sourceRowIndex: 99, actionId: "recheck" }), true);
});

test("file-scope active runs use canonical physical identity and exclude terminal results", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-active-"));
  try {
    await mkdir(path.join(root, "data"), { recursive: true });
    await writeFile(path.join(root, "data", "items.json"), "[]");
    const context = { projectRoot: root, runtimeDir: ".data-editor/runtime" };
    const identity = await canonicalFileIdentity(context, "data/items.json");
    const active = { runId: "active-run", action: { id: "rename" }, entry: { sourcePath: "data/items.json", canonicalFileKey: identity.canonicalFileKey } };
    const completed = { runId: "done-run", action: { id: "rename" }, entry: { sourcePath: "data/items.json", canonicalFileKey: identity.canonicalFileKey } };
    await mkdir(path.dirname(entryActionHandoffPath(context, active.runId)), { recursive: true });
    await writeFile(entryActionHandoffPath(context, active.runId), JSON.stringify(active));
    await writeFile(entryActionHandoffPath(context, completed.runId), JSON.stringify(completed));
    await writeFile(path.join(path.dirname(entryActionHandoffPath(context, completed.runId)), `${completed.runId}.result.json`), JSON.stringify({ runId: completed.runId, phase: "terminal", outcome: "completed_with_writeback" }));
    const found = await findActiveEntryActionRuns(context, "data/items.json");
    assert.equal(found.canonicalFileKey, identity.canonicalFileKey);
    assert.deepEqual(found.runs.map((run) => run.runId), [active.runId]);
  } finally { await rm(root, { recursive: true, force: true }); }
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
