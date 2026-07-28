export const entryActionActivePhases = Object.freeze(["queued", "running", "proposal_ready", "committing"]);
export const entryActionTerminalOutcomes = Object.freeze([
  "completed_with_writeback",
  "completed_without_changes",
  "conflicted",
  "rejected",
  "failed",
  "timed_out",
  "failed_needs_recovery",
]);

export function isTerminalEntryActionState(value) {
  if (!value || typeof value !== "object") return false;
  return value.phase === "terminal" && typeof value.outcome === "string" && entryActionTerminalOutcomes.includes(value.outcome);
}

export function normalizeEntryActionStateRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw stateError();
  if (isTerminalEntryActionState(value) || entryActionActivePhases.includes(value.phase)) return { ...value };
  const outcome = legacyOutcome(value.status);
  if (outcome) {
    const { status: _status, ...rest } = value;
    return { ...rest, phase: "terminal", outcome };
  }
  if (value.status === "started") {
    const { status: _status, ...rest } = value;
    return { ...rest, phase: "running", outcome: null };
  }
  throw stateError();
}

function legacyOutcome(status) { return ({ rejected: "rejected", failed: "failed", completed_with_writeback: "completed_with_writeback", completed_without_observed_writeback: "completed_without_changes" })[status] ?? null; }
function stateError() { return Object.assign(new Error("ENTRY_ACTION_STATE_INVALID"), { code: "ENTRY_ACTION_STATE_INVALID" }); }
