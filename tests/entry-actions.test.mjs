import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from "node:fs/promises";
import { buildDocumentModel } from "../src/document-model.mjs";
import { entryActionHandoffPath, entryActionStartedPath, entryActionResultPath, findLatestEntryActionRun, findActiveEntryActionRuns, matchesEntryActionIdentity, resolveEntryActionRow, validateEntryActionTarget } from "../src/entry-actions.mjs";
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


test("latest history uses the immutable started clock when newer blocked handoff lacks createdAt without rewriting records", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "latest-history-clock-")); t.after(() => rm(root, { recursive: true, force: true }));
  const context = { projectRoot: root, runtimeDir: ".data-editor/runtime" };
  const identity = { actionId: "design-item", sourcePath: "data/items.json", collectionPath: "items", rowId: "row-1" };
  const older = "10000000-0000-4000-8000-000000000071", newer = "10000000-0000-4000-8000-000000000078";
  const oldTime = "2026-10-14T02:45:44.586Z", acceptedAt = "2026-10-14T02:46:00.000Z";
  const action = { id: identity.actionId }, entry = { ...identity };
  await mkdir(path.dirname(entryActionHandoffPath(context, older)), { recursive: true });
  const records = [
    [entryActionHandoffPath(context, older), { version: 1, runId: older, createdAt: oldTime, action, entry }],
    [entryActionStartedPath(context, older), { version: 3, runId: older, actionId: identity.actionId, phase: "running", outcome: null, startedAt: oldTime }],
    [entryActionResultPath(context, older), { version: 3, runId: older, phase: "terminal", outcome: "failed", message: "ENOENT" }],
    [entryActionHandoffPath(context, newer), { version: 1, runId: newer, action, entry }],
    [entryActionStartedPath(context, newer), { version: 3, runId: newer, actionId: identity.actionId, phase: "committing", outcome: null, startedAt: acceptedAt }],
    [entryActionResultPath(context, newer), { version: 3, runId: newer, phase: "terminal", outcome: "completed_with_writeback", resultStatus: "blocked", message: "Partial modifications saved" }],
  ];
  const snapshots = [];
  for (const [file, value] of records) { await writeFile(file, JSON.stringify(value)); snapshots.push({ file, bytes: await readFile(file), mtime: (await stat(file)).mtimeMs }); }
  const latest = await findLatestEntryActionRun(context, identity);
  assert.equal(latest.runId, newer); assert.equal(latest.createdAt, acceptedAt);
  assert.equal(latest.outcome, "completed_with_writeback"); assert.equal(latest.resultStatus, "blocked");
  for (const snapshot of snapshots) { assert.deepEqual(await readFile(snapshot.file), snapshot.bytes); assert.equal((await stat(snapshot.file)).mtimeMs, snapshot.mtime); }
});


test("legacy history with neither createdAt nor started never invents a sorting clock or writes one", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "legacy-no-clock-")); t.after(() => rm(root, { recursive: true, force: true }));
  const context = { projectRoot: root, runtimeDir: ".data-editor/runtime" };
  const identity = { actionId: "design-item", sourcePath: "data/items.json", collectionPath: "items", rowId: "row-1" };
  const unknownRun = "10000000-0000-4000-8000-000000000078", knownRun = "10000000-0000-4000-8000-000000000071";
  await mkdir(path.dirname(entryActionHandoffPath(context, unknownRun)), { recursive: true });
  const legacy = { runId: unknownRun, action: { id: identity.actionId }, entry: identity };
  await writeFile(entryActionHandoffPath(context, unknownRun), JSON.stringify(legacy));
  await writeFile(entryActionResultPath(context, unknownRun), JSON.stringify({ runId: unknownRun, phase: "terminal", outcome: "completed_with_writeback", resultStatus: "blocked" }));
  const bytes = await readFile(entryActionHandoffPath(context, unknownRun)), mtime = (await stat(entryActionHandoffPath(context, unknownRun))).mtimeMs;
  const onlyLegacy = await findLatestEntryActionRun(context, identity);
  assert.equal(onlyLegacy.runId, unknownRun); assert.equal(onlyLegacy.createdAt, null);
  await writeFile(entryActionHandoffPath(context, knownRun), JSON.stringify({ runId: knownRun, createdAt: "2026-10-14T02:45:44.586Z", action: { id: identity.actionId }, entry: identity }));
  await writeFile(entryActionResultPath(context, knownRun), JSON.stringify({ runId: knownRun, phase: "terminal", outcome: "failed" }));
  assert.equal((await findLatestEntryActionRun(context, identity)).runId, knownRun);
  assert.deepEqual(await readFile(entryActionHandoffPath(context, unknownRun)), bytes); assert.equal((await stat(entryActionHandoffPath(context, unknownRun))).mtimeMs, mtime);
  await assert.rejects(readFile(entryActionStartedPath(context, unknownRun)), { code: "ENOENT" });
});
