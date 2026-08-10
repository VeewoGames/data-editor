export async function recoverDurableEntryActionOperation({ started, recoverProposal, recoverCandidate }) {
  if (!started || typeof started !== "object" || typeof started.runId !== "string" || typeof started.actionId !== "string") fail("ENTRY_ACTION_RECOVERY_OPERATION_INVALID");
  if (started.operation === "candidate_create") {
    if (typeof started.idempotencyKey !== "string" || typeof started.candidateId !== "string" || typeof recoverCandidate !== "function") fail("ENTRY_ACTION_RECOVERY_OPERATION_INVALID");
    return recoverCandidate(started);
  }
  if (started.operation == null || started.operation === "proposal") {
    if (typeof recoverProposal !== "function") fail("ENTRY_ACTION_RECOVERY_OPERATION_INVALID");
    return recoverProposal(started);
  }
  fail("ENTRY_ACTION_RECOVERY_OPERATION_INVALID");
}

function fail(code) { throw Object.assign(new Error(code), { code }); }
