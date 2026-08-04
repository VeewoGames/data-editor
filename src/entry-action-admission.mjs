import { loadAutomationBindings } from "./automation-bindings.mjs";
import { loadAutomationProfile } from "./automation-profile.mjs";
import { resolveCodexBindingStatus } from "./codex-runtime.mjs";
import { findAutomationEntryAction, normalizeEntryActionPath, resolveAutomationEntryActionBinding, validateEntryActionTarget } from "./entry-actions.mjs";
import { migrateLegacyEntryActionPolicy } from "./entry-action-policy-migration.mjs";

/** Read/validate action authority before an identity promotion is allowed to write. */
export async function preflightEntryActionAdmission({ projectContext, request, resolveBindingStatus = resolveCodexBindingStatus }) {
  const actionId = String(request?.actionId ?? "").trim();
  await migrateLegacyEntryActionPolicy(projectContext);
  const [profile, bindings] = await Promise.all([loadAutomationProfile(projectContext), loadAutomationBindings(projectContext)]);
  const action = findAutomationEntryAction(profile, actionId);
  const binding = resolveAutomationEntryActionBinding(bindings, action.id);
  const status = await resolveBindingStatus(binding, { projectRoot: projectContext.projectRoot });
  if (status.status !== "ready") fail("ENTRY_ACTION_BINDING_INVALID", status.message ?? "Automation binding is unavailable.", 400);
  const sourcePath = normalizeEntryActionPath(request.sourcePath, "sourcePath");
  const collectionPath = normalizeEntryActionPath(request.collectionPath, "collectionPath");
  validateEntryActionTarget(action, sourcePath, collectionPath);
  return { actionId: action.id, sourcePath, collectionPath };
}

function fail(code, message, status) { throw Object.assign(new Error(message), { code, status }); }
