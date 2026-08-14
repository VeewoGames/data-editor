import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isTerminalEntryActionState, migrateLegacyEntryActionStateRecord, normalizeEntryActionStateRecord } from "../src/entry-action-state.mjs";
import { advanceEntryActionPhase, entryActionResultPath, entryActionStartedPath, migrateLegacyEntryActionStateArtifacts, readEntryActionResult, readEntryActionStarted, writeEntryActionStarted } from "../src/entry-actions.mjs";

test("only a declared terminal outcome ends entry-action waiting", () => {
  for (const phase of ["queued", "running", "proposal_ready", "committing"]) assert.equal(isTerminalEntryActionState({ phase }), false);
  assert.equal(isTerminalEntryActionState({ phase: "terminal", outcome: "completed_with_writeback" }), true);
  assert.equal(isTerminalEntryActionState({ phase: "terminal", outcome: "timed_out" }), true);
  assert.equal(isTerminalEntryActionState({ phase: "terminal", outcome: "observation_timed_out" }), false);
  assert.equal(isTerminalEntryActionState({ phase: "terminal", outcome: "completed_without_observed_writeback" }), false);
});

test("legacy result artifacts are rejected instead of entering a compatibility path", () => {
  assert.throws(() => normalizeEntryActionStateRecord({ runId: "old", status: "started" }), { code: "ENTRY_ACTION_STATE_INVALID" });
  assert.throws(() => normalizeEntryActionStateRecord({ runId: "old", status: "completed_without_observed_writeback" }), { code: "ENTRY_ACTION_STATE_INVALID" });
});

test("legacy runtime artifacts are migrated once before v2-only reads", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-state-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = { projectRoot: root, runtimeDir: ".data-editor/runtime" };
  const runId = "legacy-run";
  await mkdir(path.dirname(entryActionStartedPath(context, runId)), { recursive: true });
  await writeFile(entryActionStartedPath(context, runId), JSON.stringify({ runId, actionId: "fill-data-name", status: "started", startedAt: "2026-07-26T10:00:00.000Z" }));
  await writeFile(entryActionResultPath(context, runId), JSON.stringify({ runId, actionId: "fill-data-name", status: "completed_with_writeback", finishedAt: "2026-07-26T10:01:00.000Z" }));

  const migration = await migrateLegacyEntryActionStateArtifacts(context);

  assert.equal(migration.migrated.length, 2);
  assert.equal((await readEntryActionStarted(context, runId)).phase, "review_running");
  assert.equal((await readEntryActionResult(context, runId)).outcome, "completed_with_writeback");
  assert.equal(JSON.parse(await readFile(entryActionResultPath(context, runId), "utf8")).status, undefined);
  assert.deepEqual(migrateLegacyEntryActionStateRecord({ runId, status: "unrecognized" }, "result"), null);
});

test("active phases advance monotonically and survive detail-panel reloads", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runId = "7d671df6-1f59-47d3-b3d8-09b95b587cee";
  await writeEntryActionStarted(root, runId, {
    version: 2,
    runId,
    actionId: "fixture-action",
    phase: "running",
    outcome: null,
    startedAt: "2026-07-29T00:00:00.000Z",
  });
  await advanceEntryActionPhase(root, runId, "proposal_ready");
  await advanceEntryActionPhase(root, runId, "committing");
  assert.equal((await readEntryActionStarted(root, runId)).phase, "committing");
  await assert.rejects(
    advanceEntryActionPhase(root, runId, "running"),
    { code: "ENTRY_ACTION_PHASE_REGRESSION" },
  );
});
