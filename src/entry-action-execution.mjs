import { findAutomationEntryAction } from "./entry-actions.mjs";
import { loadAutomationProfile } from "./automation-profile.mjs";

export async function resolveEntryActionExecution(projectContext, actionId, { loadProfile = loadAutomationProfile } = {}) {
  const profile = await loadProfile(projectContext);
  const action = findAutomationEntryAction(profile, actionId);
  const kind = action?.execution?.kind;
  if (kind !== "proposal" && kind !== "project-skill") {
    throw Object.assign(new Error("Entry action execution kind is unavailable."), { code: "ENTRY_ACTION_EXECUTION_KIND_INVALID", status: 409 });
  }
  const resultPolicy = action?.execution?.resultPolicy;
  if (!["proposal", "result-only"].includes(resultPolicy)) {
    throw Object.assign(new Error("Entry action result policy is unavailable."), { code: "ENTRY_ACTION_RESULT_POLICY_INVALID", status: 409 });
  }
  return { action, kind, resultPolicy, contractId: action.contractId };
}
