// Execution reports and write proposals have separate, closed status contracts.
export const resultOnlyStatuses = Object.freeze([
  "completed", "no_changes", "failed", "blocked", "stopped", "evidence_insufficient",
  "changes_required", "approved", "checked", "passed", "rejected",
]);
export const proposalResultStatuses = Object.freeze(resultOnlyStatuses.filter((value) => !["failed", "no_changes"].includes(value)));
export const incompleteResultStatuses = Object.freeze(["failed", "blocked", "stopped", "evidence_insufficient", "changes_required", "rejected"]);

export function assertProposalResultStatus(proposal) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) throw Object.assign(new Error("Proposal status container must be an object."), { code: "ENTRY_ACTION_PROPOSAL_INVALID" });
  if (Object.hasOwn(proposal, "resultStatus") && !proposalResultStatuses.includes(proposal.resultStatus)) {
    throw Object.assign(new Error("Proposal resultStatus is invalid or incompatible with a write proposal."), { code: "ENTRY_ACTION_PROPOSAL_INVALID" });
  }
}
export function proposalResultStatusDetails(proposal) {
  assertProposalResultStatus(proposal);
  return Object.hasOwn(proposal, "resultStatus") ? { resultStatus: proposal.resultStatus } : {};
}

export function resolveResultOnlyStatus(result) {
  const values = [result?.status, result?.designVerdict, result?.verdict, result?.result?.status, result?.result?.designVerdict, result?.result?.verdict].filter((value) => value !== undefined);
  if (!values.length || values.some((value) => !resultOnlyStatuses.includes(value))) {
    throw Object.assign(new Error("Result-only output requires a recognized structured status or review verdict."), { code: "PROJECT_SKILL_RESULT_INVALID" });
  }
  // An outer completed report must not hide a nested failure or unresolved verdict.
  return incompleteResultStatuses.find((value) => values.includes(value)) ?? values[0];
}

export function resolveProposalResultStatusDetails(envelope) {
  const outer = proposalResultStatusDetails(envelope);
  const inner = envelope?.proposal ? proposalResultStatusDetails(envelope.proposal) : outer;
  if (outer.resultStatus && inner.resultStatus && outer.resultStatus !== inner.resultStatus) {
    throw Object.assign(new Error("Proposal envelope and body result statuses differ."), { code: "ENTRY_ACTION_PROPOSAL_INVALID" });
  }
  return { ...outer, ...inner };
}
