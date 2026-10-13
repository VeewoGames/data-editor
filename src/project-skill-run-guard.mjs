import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadAutomationProfile } from "./automation-profile.mjs";
import { loadAutomationBindings } from "./automation-bindings.mjs";
import { entryActionHandoffPath, entryActionsRuntimeDir, readEntryActionResult } from "./entry-actions.mjs";
import {canonicalProjectArtifactIdentity} from './canonical-project-artifact-identity.mjs';
import path from "node:path";

export function projectSkillConfigDigest(profile, bindings) {
  return crypto.createHash("sha256").update(JSON.stringify({ rules: profile.rules, bindings })).digest("hex");
}
export function projectSkillCancellationPath(context, runId) {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("Invalid project-skill run id");
  return path.join(entryActionsRuntimeDir(context), `${runId}.cancel.json`);
}
export async function assertProjectSkillRunCurrent(context, runId) {
  const handoff = await readFile(entryActionHandoffPath(context, runId), "utf8").then(JSON.parse, (error) => { if (error.code === "ENOENT") return null; throw error; });
  if (!handoff?.projectSkillLifecycle) return;
  const ids = [runId, handoff.projectSkillLifecycle.parentRunId].filter(Boolean);
  for (const id of ids) {
    const cancelled = await readFile(projectSkillCancellationPath(context, id), "utf8").then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; });
    if (cancelled) throw Object.assign(new Error("Project skill cancelled; committed parent output is retained."), { code: "PROJECT_SKILL_CANCELLED" });
  }
  if (handoff.projectSkillLifecycle.configDigest) {
    const [profile, bindings] = await Promise.all([loadAutomationProfile(context), loadAutomationBindings(context)]);
    if (projectSkillConfigDigest(profile, bindings) !== handoff.projectSkillLifecycle.configDigest) throw Object.assign(new Error("Automation configuration changed; followup stopped."), { code: "PROJECT_SKILL_CONFIG_STALE" });
  }
  const frozen=handoff.projectSkillLifecycle.documentSnapshot;
  const terminal=await readEntryActionResult(context,runId).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if (frozen && terminal?.outcome!=='completed_with_writeback') {
    const identity=await canonicalProjectArtifactIdentity(context,frozen.path);
    const text=await readFile(identity.resolvedPath,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    const current=text===null?null:crypto.createHash('sha256').update(text).digest('hex');
    if (current!==frozen.digest) throw Object.assign(new Error('Development document changed during execution.'),{code:'PROJECT_SKILL_DOCUMENT_STALE'});
  }
}
