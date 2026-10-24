import test from "node:test";
import assert from "node:assert/strict";
import {
  EntryActionResultWaitCancelledError,
  waitForEntryActionResult,
} from "../src/entry-action-result-wait.ts";

test("waitForEntryActionResult switches to background polling and resolves delayed completion", async () => {
  const statuses = [
    { runId: "run-1", phase: "running" },
    { runId: "run-1", phase: "running" },
    { runId: "run-1", phase: "committing" },
    { runId: "run-1", phase: "terminal", outcome: "completed_with_writeback", message: "done" },
  ];
  let enteredBackground = 0;
  const pendingPhases = [];

  const outcome = await waitForEntryActionResult({
    backgroundIntervalMs: 0,
    backgroundPollLimit: 3,
    foregroundIntervalMs: 0,
    foregroundPollLimit: 2,
    loadResult: async () => statuses.shift(),
    onEnterBackgroundWait: () => {
      enteredBackground += 1;
    },
    onPendingResult: (result) => {
      pendingPhases.push(result.phase);
    },
    projectId: "project-1",
    runId: "run-1",
  });

  assert.equal(enteredBackground, 1);
  assert.equal(outcome.kind, "completed");
  assert.equal(outcome.delayed, true);
  assert.equal(outcome.result.outcome, "completed_with_writeback");
  assert.deepEqual(pendingPhases, ["running", "running", "committing"]);
});

test("waitForEntryActionResult returns timed_out instead of throwing when background wait is exhausted", async () => {
  const outcome = await waitForEntryActionResult({
    backgroundIntervalMs: 0,
    backgroundPollLimit: 2,
    foregroundIntervalMs: 0,
    foregroundPollLimit: 1,
    loadResult: async () => ({ runId: "run-1", phase: "running" }),
    projectId: "project-1",
    runId: "run-1",
  });

  assert.deepEqual(outcome, { kind: "timed_out", delayed: true });
});

test("waitForEntryActionResult aborts when shouldContinue turns false", async () => {
  let shouldContinue = true;

  await assert.rejects(
    () => waitForEntryActionResult({
      backgroundIntervalMs: 0,
      backgroundPollLimit: 2,
      foregroundIntervalMs: 0,
      foregroundPollLimit: 2,
      loadResult: async () => {
        shouldContinue = false;
        return { runId: "run-1", phase: "running" };
      },
      projectId: "project-1",
      runId: "run-1",
      shouldContinue: () => shouldContinue,
    }),
    EntryActionResultWaitCancelledError,
  );
});

test("temporary disconnect resumes polling the same run rather than reporting failed write", async () => {
  const ids=[]; let attempts=0;
  const outcome=await waitForEntryActionResult({runId:'original-run',projectId:'project-1',foregroundPollLimit:3,backgroundPollLimit:1,foregroundIntervalMs:0,backgroundIntervalMs:0,loadResult:async(runId,projectId)=>{
    ids.push([runId,projectId]); if(++attempts===1)throw new TypeError('Failed to fetch');
    if(attempts===2)throw Object.assign(new Error('unavailable'),{status:503});
    return {runId,phase:'terminal',outcome:'completed_with_writeback'};
  }});
  assert.equal(outcome.kind,'completed');assert.equal(outcome.result.outcome,'completed_with_writeback');assert.deepEqual(ids,Array(3).fill(['original-run','project-1']));
});
test("permanent polling errors still surface and prolonged offline remains unknown",async()=>{
 const opts={runId:'run-1',projectId:'p',foregroundPollLimit:1,backgroundPollLimit:1,foregroundIntervalMs:0,backgroundIntervalMs:0};
 await assert.rejects(waitForEntryActionResult({...opts,loadResult:async()=>{throw Object.assign(new Error('forbidden'),{status:403});}}),/forbidden/);
 assert.deepEqual(await waitForEntryActionResult({...opts,loadResult:async()=>{throw new TypeError('offline');}}),{kind:'timed_out',delayed:true});
});
