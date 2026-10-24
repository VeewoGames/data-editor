import { publicationIsOpen, publicationExistingOperation, publicationObserve } from './publication-window-runtime.mjs';
import crypto from "node:crypto";
import {withHistoricalRun,assertHistoricalRunAllowed} from './historical-disposition.mjs';
import path from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { atomicWrite, exclusiveCreateLock } from "./atomic-file.mjs";
import { entryActionsRuntimeDir, entryActionHandoffPath, entryActionStartedPath, readEntryActionResult } from "./entry-actions.mjs";
import { loadAutomationProfile } from "./automation-profile.mjs";
import { assertProjectSkillRunCurrent, projectSkillCancellationPath } from "./project-skill-run-guard.mjs";

const active = new Map();
const ownerClaims = new Map();
const optionalJson = (file) => readFile(file, "utf8").then(JSON.parse, (error) => { if (error.code === "ENOENT") return null; throw error; });
const intentPath = (context, runId) => path.join(entryActionsRuntimeDir(context), `${runId}.followup.json`);
const cancelled = async (context, runId) => Boolean(await optionalJson(projectSkillCancellationPath(context, runId)));

export function followupIdentity(parentRunId, actionId, entry) {
  const key = crypto.createHash("sha256").update(JSON.stringify([parentRunId, actionId, entry.sourcePath, entry.collectionPath, entry.rowId])).digest("hex");
  const hex = key.slice(0, 12) + "4" + key.slice(13, 16) + "8" + key.slice(17, 32);
  return { key, childRunId: `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}` };
}

export function trackProjectSkillRun(context, runId, completion, terminate) {
  const key = `${entryActionsRuntimeDir(context)}:${runId}`;
  const record = active.get(key) ?? {};
  if (completion) { record.completion = completion; void completion.finally(() => { if (active.get(key) === record) active.delete(key); }).catch(() => {}); }
  if (terminate) record.terminate = terminate;
  active.set(key, record);
}

export async function cancelProjectSkillEntryAction(context, runId) {
  await assertHistoricalRunAllowed(context,[runId],{fullInventory:true});
  const handoff = await optionalJson(entryActionHandoffPath(context, runId));
  if (!handoff?.projectSkillLifecycle) throw new Error("Unknown project-skill run");
  await mkdir(entryActionsRuntimeDir(context), { recursive: true });
  await atomicWrite(projectSkillCancellationPath(context, runId), JSON.stringify({ runId, cancelledAt: new Date().toISOString() }));
  await active.get(`${entryActionsRuntimeDir(context)}:${runId}`)?.terminate?.();
  const intent = await optionalJson(intentPath(context, runId));
  if (intent?.childRunId) await active.get(`${entryActionsRuntimeDir(context)}:${intent.childRunId}`)?.terminate?.();
  return { runId, cancelled: true, parentOutputRetained: true };
}

async function resumeProjectSkillFollowupImplementation({ projectContext, parentRunId, startChild }) {
  if (!await publicationIsOpen(projectContext)) return { state:'deferred', code:'PUBLICATION_WINDOW_CLOSED', parentRunId };
  const pathKey = intentPath(projectContext, parentRunId);
  if (ownerClaims.has(pathKey)) return ownerClaims.get(pathKey);
  const work = resume({ projectContext, parentRunId, startChild });
  ownerClaims.set(pathKey, work);
  try { return await work; } finally { if (ownerClaims.get(pathKey) === work) ownerClaims.delete(pathKey); }
}

async function resume({ projectContext, parentRunId, startChild }) {
  const handoff = await optionalJson(entryActionHandoffPath(projectContext, parentRunId));
  const spec = handoff?.projectSkillLifecycle?.followup;
  if (!spec || !handoff.entry?.rowId) return null;
  const parent = await optionalJson(path.join(entryActionsRuntimeDir(projectContext), `${parentRunId}.result.json`));
  const trigger = parent?.outcome === "completed_with_writeback" ? "completed_with_writeback"
    : parent?.outcome === "completed_without_changes" && parent.resultStatus === "no_changes" ? "no_changes" : null;
  if (!spec.on.includes(trigger)) return null;
  const identity = followupIdentity(parentRunId, spec.actionId, handoff.entry);
  const file = intentPath(projectContext, parentRunId);
  let mutationAdmission;
  const admitMutation=()=>mutationAdmission??=assertHistoricalRunAllowed(projectContext,[parentRunId],{fullInventory:true});
  let intent = await optionalJson(file);
  if (!intent) {
    intent = { version: 1, parentRunId, actionId: spec.actionId, ...identity, configDigest: handoff.projectSkillLifecycle.configDigest, target: { sourcePath: handoff.entry.sourcePath, collectionPath: handoff.entry.collectionPath, rowId: handoff.entry.rowId }, trigger, state: "pending" };
    await admitMutation();
    try { await exclusiveCreateLock(file, JSON.stringify(intent)); } catch (error) { if (error.code !== "EEXIST") throw error; intent = await optionalJson(file); }
  }
  if (intent.key !== identity.key || intent.childRunId !== identity.childRunId || intent.configDigest !== handoff.projectSkillLifecycle.configDigest) throw new Error("Followup identity conflict");
  const save = async (state, details = {}) => { await admitMutation();intent = { ...intent, state, ...details }; await atomicWrite(file, JSON.stringify(intent)); return intent; };
  let childResult = await optionalJson(path.join(entryActionsRuntimeDir(projectContext), `${intent.childRunId}.result.json`));
  if (childResult) {
    if(intent.state==='completed'&&intent.childOutcome===childResult.outcome&&intent.childResultStatus===(childResult.resultStatus??null))return intent;
    return save("completed", { childOutcome: childResult.outcome, childResultStatus: childResult.resultStatus ?? null });
  }
  if (["completed", "stopped"].includes(intent.state)) return intent;
  try {
    await assertProjectSkillRunCurrent(projectContext, parentRunId);
    if (await cancelled(projectContext, intent.childRunId)) throw Object.assign(new Error("Followup cancelled"), { code: "PROJECT_SKILL_CANCELLED" });
    const profile = await loadAutomationProfile(projectContext);
    const child = profile.rules.find((rule) => rule.id === spec.actionId);
    if (!child || child.enabled === false || child.followup || child.execution.kind !== "project-skill") throw new Error("Followup must reference an enabled existing project-skill with no followup");
    const live = active.get(`${entryActionsRuntimeDir(projectContext)}:${intent.childRunId}`);
    if (live) return intent;
    const started = await optionalJson(entryActionStartedPath(projectContext, intent.childRunId));
    if (started) {
      // A different service can own this accepted child. The durable receipt is
      // the cross-process CAS; never cancel or overwrite its live execution.
      if (Number.isSafeInteger(started.ownerPid) && isProcessAlive(started.ownerPid)) return intent;
      await admitMutation();
      await atomicWrite(projectSkillCancellationPath(projectContext, intent.childRunId), JSON.stringify({ runId: intent.childRunId, reason: "interrupted recovery" }));
      return save("stopped", { code: "PROJECT_SKILL_FOLLOWUP_INTERRUPTED", message: "Child was accepted before restart and has no terminal receipt; explicit retry is required. Parent output is retained." });
    }
    await save("launching");
    await assertProjectSkillRunCurrent(projectContext, parentRunId);
    const accepted = await startChild({ request: { ...intent.target, actionId: spec.actionId }, childRunId: intent.childRunId, parentRunId, configDigest: intent.configDigest });
    await save("running");
    void accepted.completion.then(async () => {
      childResult = await readEntryActionResult(projectContext, intent.childRunId);
      await save("completed", { childOutcome: childResult.outcome, childResultStatus: childResult.resultStatus ?? null });
    }, async (error) => { await save("stopped", { code: error.code ?? "PROJECT_SKILL_FOLLOWUP_FAILED", message: error.message }); }).catch(() => {});
    return intent;
  } catch (error) {
    if (error.code === "EEXIST" && await optionalJson(entryActionStartedPath(projectContext, intent.childRunId))) {
      // Another process won the started-receipt CAS. Its completion owns state.
      return await optionalJson(file);
    }
    if (error.code === 'PUBLICATION_WINDOW_CLOSED') return save('pending', { code:error.code, deferred:true });
    return save("stopped", { code: error.code ?? "PROJECT_SKILL_FOLLOWUP_FAILED", message: error.message });
  }
}

export async function recoverProjectSkillFollowups({ projectContext, startChild }) {
  let names;
  try { names = await readdir(entryActionsRuntimeDir(projectContext)); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const results = [];
  for (const name of names.filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name))) {
    const handoff = await optionalJson(path.join(entryActionsRuntimeDir(projectContext), name));
    if (handoff?.projectSkillLifecycle?.followup) results.push(await resumeProjectSkillFollowup({ projectContext, parentRunId: handoff.runId, startChild }));
  }
  return results.filter(Boolean);
}

export async function readProjectSkillFollowup(context, runId) { return optionalJson(intentPath(context, runId)); }

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}
export async function resumeProjectSkillFollowup(input) {
  const result = await withHistoricalRun(input.projectContext,[input.parentRunId],()=>publicationObserve(input.projectContext, `followup:${input.parentRunId}`, () => resumeProjectSkillFollowupImplementation(input)));
  return result?.reason === 'publication_window_closed' ? {state:'deferred',code:'PUBLICATION_WINDOW_CLOSED',parentRunId:input.parentRunId} : result;
}
