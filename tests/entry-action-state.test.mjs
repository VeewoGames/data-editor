import assert from "node:assert/strict";
import test from "node:test";
import { isTerminalEntryActionState, normalizeEntryActionStateRecord } from "../src/entry-action-state.mjs";

test("only a declared terminal outcome ends entry-action waiting", () => {
  for (const phase of ["queued", "running", "proposal_ready", "committing"]) assert.equal(isTerminalEntryActionState({ phase }), false);
  assert.equal(isTerminalEntryActionState({ phase: "terminal", outcome: "completed_with_writeback" }), true);
  assert.equal(isTerminalEntryActionState({ phase: "terminal", outcome: "timed_out" }), true);
  assert.equal(isTerminalEntryActionState({ phase: "terminal", outcome: "observation_timed_out" }), false);
  assert.equal(isTerminalEntryActionState({ phase: "terminal", outcome: "completed_without_observed_writeback" }), false);
});

test("historical result artifacts normalize to the new phase and outcome contract", () => {
  assert.deepEqual(normalizeEntryActionStateRecord({ runId: "old", status: "started" }), { runId: "old", phase: "running", outcome: null });
  assert.deepEqual(normalizeEntryActionStateRecord({ runId: "old", status: "completed_without_observed_writeback" }), { runId: "old", phase: "terminal", outcome: "completed_without_changes" });
});
