import assert from "node:assert/strict";
import test from "node:test";
import { recoverDurableEntryActionOperation } from "../src/entry-action-durable-recovery.mjs";

test("durable recovery dispatches candidate_create with its bound run and idempotency identity", async () => {
  const started = { runId: "run-1", actionId: "create", operation: "candidate_create", idempotencyKey: "candidate_create_key", candidateId: "alpha" };
  const result = await recoverDurableEntryActionOperation({ started, recoverCandidate: async (value) => ({ operation: value.operation, runId: value.runId, idempotencyKey: value.idempotencyKey }), recoverProposal: async () => assert.fail("wrong recovery") });
  assert.deepEqual(result, { operation: "candidate_create", runId: "run-1", idempotencyKey: "candidate_create_key" });
});

test("durable recovery defaults legacy/proposal starts only to proposal recovery and rejects unknown operations", async () => {
  const proposal = await recoverDurableEntryActionOperation({ started: { runId: "run-2", actionId: "update", operation: "proposal" }, recoverProposal: async () => "proposal", recoverCandidate: async () => assert.fail("wrong recovery") });
  assert.equal(proposal, "proposal");
  await assert.rejects(() => recoverDurableEntryActionOperation({ started: { runId: "run-3", actionId: "x", operation: "other" }, recoverProposal: async () => {}, recoverCandidate: async () => {} }), { code: "ENTRY_ACTION_RECOVERY_OPERATION_INVALID" });
});
