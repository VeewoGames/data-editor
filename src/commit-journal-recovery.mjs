export function classifyCommitJournalRecovery({ entry, currentEtag, currentDigest, proposalAfterMatches = false }) {
  if (!entry || typeof currentEtag !== "string" || typeof currentDigest !== "string") fail();
  const newSourceMatches = currentEtag === entry.newEtag && currentDigest === entry.afterDigest;
  if (entry.stage === "commit_intent" && currentEtag === entry.baseEtag && currentDigest === entry.beforeDigest) return { disposition: "uncommitted", nextStage: null };
  if (entry.stage === "commit_intent" && newSourceMatches) {
    if (entry.saveType === "proposal_commit" && !proposalAfterMatches) return recoveryFailure();
    return { disposition: "resume", nextStage: "source_replaced" };
  }
  if (entry.stage === "source_replaced" && newSourceMatches) return { disposition: "resume", nextStage: "verified" };
  if (entry.stage === "verified" && newSourceMatches) return { disposition: "resume", nextStage: "result_published" };
  if (entry.stage === "result_published" && newSourceMatches) return { disposition: "completed", nextStage: null };
  return recoveryFailure();
}
function recoveryFailure() { return { disposition: "failed_needs_recovery", nextStage: null }; }
function fail() { throw Object.assign(new Error("COMMIT_JOURNAL_RECOVERY_INVALID"), { code: "COMMIT_JOURNAL_RECOVERY_INVALID" }); }
