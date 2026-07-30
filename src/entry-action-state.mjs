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
  throw stateError();
}

/**
 * Converts a persisted pre-v2 artifact once. Normal reads must stay v2-only.
 */
export function migrateLegacyEntryActionStateRecord(value, artifactKind) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.phase) return null;
  const status = typeof value.status === "string" ? value.status : null;
  if (!status) return null;

  const { status: _legacyStatus, ...rest } = value;
  if (artifactKind === "started" && status === "started") {
    return {
      ...rest,
      version: 2,
      phase: "running",
      outcome: null,
      updatedAt: value.updatedAt ?? value.startedAt ?? null,
    };
  }

  if (artifactKind !== "result") return null;
  const outcome = legacyTerminalOutcome(status);
  if (!outcome) return null;
  return {
    ...rest,
    version: 2,
    phase: "terminal",
    outcome,
    updatedAt: value.updatedAt ?? value.finishedAt ?? null,
  };
}

function legacyTerminalOutcome(status) {
  if (status === "completed_with_writeback") return "completed_with_writeback";
  if (status === "completed" || status === "completed_without_observed_writeback") return "completed_without_changes";
  if (status === "failed") return "failed";
  if (status === "timed_out") return "timed_out";
  return null;
}

function stateError() { return Object.assign(new Error("ENTRY_ACTION_STATE_INVALID"), { code: "ENTRY_ACTION_STATE_INVALID" }); }
