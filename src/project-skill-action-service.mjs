import { publicationStart, publicationSubmit, publicationRecovery, publicationExistingOperation, publicationConfigWrite, publicationObserve, publicationIsOpen } from './publication-window-runtime.mjs';
import { resolveResultOnlyStatus, resolveProposalResultStatusDetails, resultOnlyStatuses, proposalResultStatuses } from "./entry-action-result-status.mjs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, realpath, rm, writeFile as rawWriteFile } from "node:fs/promises";
import {withHistoricalFileEffect,withHistoricalScopeEffect,cleanupHistoricalRun} from './historical-disposition.mjs';
const writeFile=(file,data,options)=>withHistoricalFileEffect(file,null,()=>rawWriteFile(file,data,options));
import { createWriteStream } from "node:fs";
import { loadAutomationBindings } from "./automation-bindings.mjs";
import { loadAutomationProfile } from "./automation-profile.mjs";
import { resolveAutomationExecutionConfig } from "./automation-runtime.mjs";
import { resolveCodexBindingStatus } from "./codex-runtime.mjs";
import { readTextFile } from "./file-service.mjs";
import { buildDocumentModel } from "./document-model.mjs";
import { parseCsv } from "./csv-codec.mjs";
import { parseJson } from "./json-codec.mjs";
import {
  advanceEntryActionPhase,
  buildEntryActionHandoff,
  entryActionDiagnosticsPath,
  entryActionEventsPath,
  entryActionOutputPath,
  findAutomationEntryAction,
  resolveEntryActionRow,
  publishEntryActionResultIdempotently,
  writeEntryActionHandoff,
  writeEntryActionStarted,
} from "./entry-actions.mjs";
import { normalizeEntryActionPath, validateEntryActionTarget } from "./entry-actions.mjs";
import { atomicWrite } from "./atomic-file.mjs";
import { validateEntryActionEvidence } from "./entry-action-evidence.mjs";
import {projectSkillConfigDigest, assertProjectSkillRunCurrent} from './project-skill-run-guard.mjs';
import {trackProjectSkillRun, resumeProjectSkillFollowup} from './project-skill-followup.mjs';
import {rowDigest} from './row-digest.mjs';
import {loadViewConfig} from './view-config.mjs';
import {resolveEntryActionDocumentTarget} from './entry-action-document-target.mjs';
import {canonicalProjectArtifactIdentity} from './canonical-project-artifact-identity.mjs';

async function startProjectSkillEntryActionImplementation({ projectContext, project, request, toolRoot, jobSupervisor, dependencies = {} }) {
  const [profile, bindings] = await Promise.all([loadAutomationProfile(projectContext), loadAutomationBindings(projectContext)]);
  const action = findAutomationEntryAction(profile, String(request.actionId ?? "").trim());
  if (action.execution?.kind !== "project-skill") throw protocolError("PROJECT_SKILL_EXECUTION_REQUIRED", "Action is not a project-skill.");
  const workspaceMode = action.execution.workspaceMode ?? "snapshot";
  const projectInput = action.execution.advancedExecution?.projectInput ?? null;
  const preflightId = action.execution.advancedExecution?.preflightId ?? null;
  if (workspaceMode === "project-write" && projectInput) throw protocolError("PROJECT_SKILL_WORKSPACE_INVALID", "Project input is unavailable in project-write mode.");
  const sourcePath = projectInput != null || workspaceMode === "project-write"
    ? normalizeEntryActionPath(request.sourcePath, "sourcePath")
    : String(request.sourcePath ?? "").trim();
  const collectionPath = projectInput != null || workspaceMode === "project-write"
    ? normalizeEntryActionPath(request.collectionPath, "collectionPath")
    : String(request.collectionPath ?? "").trim();
  if (sourcePath && collectionPath) validateEntryActionTarget(action, sourcePath, collectionPath);
  const binding = bindings.bindings?.[action.id];
  const status = await (dependencies.resolveBindingStatus ?? resolveCodexBindingStatus)(binding, { projectRoot: projectContext.projectRoot });
  if (status.status !== "ready") throw protocolError("ENTRY_ACTION_BINDING_INVALID", status.message ?? "Automation binding is unavailable.");
  const skill = await readFile(status.skillPath, "utf8");
  const skillDigest = crypto.createHash("sha256").update(skill).digest("hex");
  const runtime = resolveAutomationExecutionConfig({ rule: action, binding, defaults: bindings.defaults }).runtime;
  const runId = dependencies.followupRunId ?? dependencies.runId ?? crypto.randomUUID();
  const scratch = path.join(os.tmpdir(), `data-editor-project-skill-${runId}`);
  const snapshotRoot = path.join(scratch, "input");
  // Codex workspace-write permits output only below its current workspace.
  // Keep task artifacts out of canonical project content while remaining writable.
  const outputRoot = workspaceMode === "project-write"
    ? path.join(projectContext.projectRoot, ".data-editor", "runtime", "entry-actions", ".task-output", runId)
    : path.join(snapshotRoot, ".data-editor-output");
  const rowId = typeof request.rowId === "string" ? request.rowId.trim() : null;
  const sourceRowIndex = Number.isInteger(request.sourceRowIndex) ? request.sourceRowIndex : null;
  const rowContext = sourcePath && collectionPath && rowId
    ? await readProjectSkillRowContext(projectContext, sourcePath, collectionPath, sourceRowIndex, rowId)
    : null;
  const artifactId = `project-skill-${runId}`;
  const artifactPublication = typeof dependencies.projectSkillArtifactPublicationUrl === "string"
    ? {
        endpoint: dependencies.projectSkillArtifactPublicationUrl,
        projectId: project.id,
        artifactId,
        artifactPath: `.data-editor/runtime/entry-action-artifacts/${artifactId}.json`,
      }
    : null;
  const handoff = buildEntryActionHandoff({
    runId,
    project,
    action,
    binding,
    runtime,
    sourcePath,
    collectionPath,
    rowId,
    sourceRowIndex,
    row: rowContext?.row ?? null,
    previousRow: rowContext?.previousRow ?? null,
    nextRow: rowContext?.nextRow ?? null,
    rowCount: rowContext?.rowCount ?? null,
  });
  handoff.skillArtifact = { logicalName: binding.skill, sourcePath: status.skillPath, sha256: skillDigest };
  handoff.projectSkillLifecycle = {parentRunId: dependencies.parentRunId ?? null, configDigest: dependencies.followupConfigDigest ?? projectSkillConfigDigest(profile, bindings), followup: action.followup ?? null};
  if (rowContext?.row && action.targets.some(target=>target.file===sourcePath && target.collection===collectionPath && target.textArtifact)) {
    const documentTarget=resolveEntryActionDocumentTarget({viewConfig:await loadViewConfig(projectContext),file:sourcePath,collection:collectionPath,row:rowContext.row});
    const identity=await canonicalProjectArtifactIdentity(projectContext,documentTarget.path);
    const text=await readFile(identity.resolvedPath,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    handoff.projectSkillLifecycle.documentSnapshot={path:documentTarget.path,digest:text===null?null:crypto.createHash('sha256').update(text).digest('hex')};
  }
  if (rowContext?.row) request = {...request, expectedRowDigest: rowDigest(rowContext.row)};
  if (action.execution.resultPolicy === "proposal") {
    handoff.projectSkillProposal = {
      envelope: "entry-action-proposal.v1",
      requiredKeys: ["kind", "changes", "textArtifact", "summary", "evidence"],
      writableFields: null,
      optionalKeys: ["resultStatus"],
      resultStatuses: proposalResultStatuses,
    };
  }
  const acceptedAt = new Date().toISOString();
  await writeEntryActionStarted(projectContext, runId, {
    version: 3,
    runId,
    actionId: action.id,
    phase: "queued",
    outcome: null,
    startedAt: acceptedAt,
    ownerPid: process.pid,
    phaseStartedAt: acceptedAt,
    phaseHistory: [{ phase: "queued", startedAt: acceptedAt }],
  });
  // Claim before publishing frozen input: a losing deterministic child must
  // never replace the accepted owner's row/document/config snapshot.
  try { await writeEntryActionHandoff(projectContext, runId, handoff); }
  catch (error) {
    await publishProjectSkillTerminal(projectContext,runId,action.id,'failed',error.message);
    throw error;
  }

  const completion = continueProjectSkillEntryAction({
    projectContext, project, request, toolRoot, jobSupervisor, dependencies,
    action, profile, bindings, workspaceMode, projectInput, preflightId, sourcePath, collectionPath,
    binding, status, skill, skillDigest, runtime, runId, scratch, snapshotRoot, outputRoot, rowId, sourceRowIndex, artifactPublication, handoff,
  });
  trackProjectSkillRun(projectContext, runId, completion);
  void completion.then(() => resumeProjectSkillFollowup({projectContext,parentRunId:runId,startChild:({request:childRequest,childRunId,parentRunId,configDigest})=>startProjectSkillEntryAction({projectContext,project,request:childRequest,toolRoot,jobSupervisor,dependencies:{...dependencies,followupRunId:childRunId,parentRunId,followupConfigDigest:configDigest}})})).catch(()=>{});
  return { runId, acceptedAt, phase: "queued", completion };
}

async function continueProjectSkillEntryAction(context) {
  const { projectContext, project, request, toolRoot, jobSupervisor, dependencies, action, profile, bindings, workspaceMode, projectInput, preflightId, sourcePath, collectionPath, binding, status, skill, skillDigest, runtime, runId, scratch, snapshotRoot, outputRoot, rowId, sourceRowIndex, artifactPublication, handoff } = context;
  let handle;
  let promptPath;
  let replyPath;
  let eventsPath;
  let diagnosticsPath;
  try {
    await mkdir(scratch, { recursive: false });
    const workspaceRoot = workspaceMode === "project-write"
      ? await realpath(projectContext.projectRoot)
      : snapshotRoot;
    if (workspaceMode === "snapshot") {
      await advanceEntryActionPhase(projectContext, runId, "preparing_input");
      if (projectInput) {
        await (dependencies.prepareInputRoot ?? runSupervisedInputPreparation)(
          { projectRoot: projectContext.projectRoot, inputRoot: workspaceRoot, projectInput, runId, toolRoot, jobSupervisor },
        );
      } else {
        await mkdir(workspaceRoot, { recursive: false });
      }
    }
    await mkdir(outputRoot, { recursive: true });
    promptPath = path.join(outputRoot, "prompt.md");
    replyPath = path.join(outputRoot, "reply.json");
    eventsPath = path.join(outputRoot, "events.jsonl");
    diagnosticsPath = path.join(outputRoot, "diagnostics.log");
    if (preflightId) {
      await advanceEntryActionPhase(projectContext, runId, "preflight_running");
      await runPreflight({ binding: bindings.preflights?.[preflightId], workspaceRoot, outputRoot, sourcePath, collectionPath, rowId, sourceRowIndex, preflightId, dependencies });
    }
    const resultPolicy = action.execution.resultPolicy;
    const shellInstruction = "Use Codex's built-in shell tool. Do not explicitly invoke an absolute path to pwsh.exe, powershell.exe, cmd.exe, or another command interpreter.";
    const workspaceInstructions = workspaceMode === "project-write"
      ? `Project workspace is the real project root at ${JSON.stringify(workspaceRoot)}. Follow the project's own instructions and only change files owned by this project skill. Data Editor diagnostics and the required JSON reply belong under ${JSON.stringify(outputRoot)}. ${shellInstruction}`
      : `Project workspace is a disposable read-only snapshot at ${JSON.stringify(workspaceRoot)}. Do not treat changes there as project output. Write task-owned output only under ${JSON.stringify(outputRoot)}. ${shellInstruction}`;
    const proposalInstruction = resultPolicy === "proposal"
      ? 'For a write proposal, return the exact entry-action-proposal envelope produced by the project skill adapter under the current project contract. textArtifact may be null or the authorized text artifact required by that contract; never invent an artifact path or bypass its document policy. Each change must contain field, beforeExists, before, afterExists, after. Do not include authority tokens or humanNotes: Data Editor binds them from the canonical target after execution. Only use no_changes after all required reading and analysis completed and no change is needed. Tool, policy, permission, contract-reading or adapter failures must return status failed; insufficient design evidence must return status blocked. A partial write proposal may include resultStatus blocked. For a completed no-change analysis, return exactly {"kind":"project-skill-result","resultOnly":true,"status":"no_changes","summary":"..."}.'
      : "Return exactly one JSON object allowed by the configured result policy.";
    await writeFile(promptPath, `${skill}\n\n## Explicit invocation\n${workspaceInstructions}\n${proposalInstruction}\n${JSON.stringify({ actionId: action.id, projectId: project.id, execution: action.execution, resultPolicy, workspaceMode, request, skillArtifact: { logicalName: binding.skill, sha256: skillDigest }, artifactPublication }, null, 2)}\n\n## Data Editor handoff\n${JSON.stringify(handoff, null, 2)}\n`, "utf8");
    await writeFile(promptPath, `\n\nIf an execution or tool failure prevents completion, return status failed.\nResult-only output must include one structured status from ${resultOnlyStatuses.join(", ")}. Never report tool or permission refusal as no_changes or completed. Use failed for execution failure and blocked for analysis with unresolved evidence. Do not infer success from the summary.\n`, { flag: "a", encoding: "utf8" });
    const hostArgs = [path.resolve(toolRoot, "scripts/run-project-skill-action-host.mjs"), "--codex", status.codexCliPath, "--workspace-root", workspaceRoot, "--output-root", outputRoot, "--prompt", promptPath, "--reply", replyPath, "--events", eventsPath, "--diagnostics", diagnosticsPath, "--model", runtime.model, "--reasoning", runtime.reasoning, "--verbosity", runtime.verbosity];
    if (workspaceMode === "snapshot") hostArgs.push("--ignore-rules");
    handle = await jobSupervisor.start({ id: runId, command: process.execPath, args: hostArgs, cwd: workspaceRoot, timeoutMs: runtime.timeoutMs });
    trackProjectSkillRun(projectContext, runId, null, handle.terminate);
    await advanceEntryActionPhase(projectContext, runId, "running");
  } catch (error) {
    const outcome = error?.code === "PROJECT_SKILL_PREPARATION_TIMED_OUT" ? "timed_out"
      : error?.code === "PROJECT_SKILL_PREPARATION_FAILED" ? "failed"
      : error?.code === "PROJECT_SKILL_PREFLIGHT_TIMED_OUT" ? "preflight_timed_out"
      : error?.code === "PROJECT_SKILL_PREFLIGHT_FAILED" ? "preflight_failed"
        : "failed";
    await publishProjectSkillTerminal(projectContext, runId, action.id, outcome, error.message ?? String(error), { errorCode: error.code ?? null });
    await copyDiagnostics(eventsPath, entryActionEventsPath(projectContext, runId)).catch(() => {});
    await copyDiagnostics(diagnosticsPath, entryActionDiagnosticsPath(projectContext, runId)).catch(() => {});
    if(!String(error?.code).startsWith('HISTORY_')){
      await cleanupHistoricalRun(async()=>{
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
      if (workspaceMode === "project-write") await rm(outputRoot, { recursive: true, force: true }).catch(() => {});
      });
    }
    throw error;
  }
  try {
      const terminal = await handle.completion;
      await assertProjectSkillRunCurrent(projectContext, runId);
      if (terminal.timedOut) {
        await copyDiagnostics(diagnosticsPath, entryActionDiagnosticsPath(projectContext, runId));
        await publishProjectSkillTerminal(projectContext, runId, action.id, "timed_out", "Codex execution timed out.");
        throw protocolError("PROJECT_SKILL_FAILED", "Project skill did not complete successfully.");
      }
      if (terminal.exitCode !== 0) {
        await copyDiagnostics(diagnosticsPath, entryActionDiagnosticsPath(projectContext, runId));
        await publishProjectSkillTerminal(projectContext, runId, action.id, "failed", `Codex exited with code ${terminal.exitCode}.`);
        throw protocolError("PROJECT_SKILL_FAILED", "Project skill did not complete successfully.");
      }
      const reply = await readFile(replyPath, "utf8");
      const outputPath = entryActionOutputPath(projectContext, runId);
      await atomicWrite(outputPath, reply);
      const result = JSON.parse(reply);
      assertProjectSkillResultPolicy(result, action.execution.resultPolicy);
      if (isProjectSkillResultOnly(result)) {
        const resultStatus = resolveProjectSkillResultStatus(result);
        await publishProjectSkillTerminal(
          projectContext,
          runId,
          action.id,
          resultStatus === "failed" ? "failed" : "completed_without_changes",
          resolveProjectSkillResultMessage(result),
          { outputPath, resultOnly: true, resultStatus },
        );
        return result;
      }
      if (action.execution.resultPolicy === "proposal") {
        if (typeof dependencies.submitProposalResult !== "function") throw protocolError("PROJECT_SKILL_PROPOSAL_ADMISSION_UNAVAILABLE", "Project-skill proposal admission is unavailable.");
        await assertProjectSkillRunCurrent(projectContext, runId);
        await advanceEntryActionPhase(projectContext, runId, "proposal_ready");
        const admitted = await dependencies.submitProposalResult({ projectContext, project, request, action, profile, runId, result });
        // Same-run admission publishes the terminal receipt as part of its
        // commit. A second publication would violate idempotency.
        if (admitted.runId !== runId) {
          await publishProjectSkillTerminal(projectContext, runId, action.id, "completed_with_writeback", resolveProjectSkillResultMessage(result), { admittedRunId: admitted.runId, admittedKind: admitted.kind, ...resolveProposalResultStatusDetails(result) });
        }
        return admitted;
      }
  } catch (error) {
      await copyDiagnostics(diagnosticsPath, entryActionDiagnosticsPath(projectContext, runId)).catch(() => {});
      await publishProjectSkillTerminal(projectContext, runId, action.id, "failed", error.message ?? String(error)).catch(() => {});
    throw error;
  } finally {
      await copyDiagnostics(eventsPath, entryActionEventsPath(projectContext, runId)).catch(() => {});
      await copyDiagnostics(diagnosticsPath, entryActionDiagnosticsPath(projectContext, runId)).catch(() => {});
      await cleanupHistoricalRun(async()=>{await rm(scratch, { recursive: true, force: true }).catch(() => {});
      if (workspaceMode === "project-write") await rm(outputRoot, { recursive: true, force: true }).catch(() => {});});
  }
}

async function runSupervisedInputPreparation({ projectRoot, inputRoot, projectInput, runId, toolRoot, jobSupervisor }) {
  const handle = await jobSupervisor.start({
    id: `${runId}:prepare`,
    command: process.execPath,
    args: [path.resolve(toolRoot, "scripts/prepare-project-skill-input.mjs"), "--project-root", projectRoot, "--input-root", inputRoot, "--paths-json", JSON.stringify(projectInput.paths)],
    cwd: projectRoot,
    timeoutMs: 60_000,
  });
  const terminal = await handle.completion;
  if (terminal.timedOut) throw protocolError("PROJECT_SKILL_PREPARATION_TIMED_OUT", "Project input preparation timed out.");
  if (terminal.exitCode !== 0) throw protocolError("PROJECT_SKILL_PREPARATION_FAILED", "Project input preparation failed.");
}

async function readProjectSkillRowContext(projectContext, sourcePath, collectionPath, sourceRowIndex, rowId) {
  const text = await readTextFile(projectContext, sourcePath);
  const extension = path.extname(sourcePath).toLowerCase();
  const parsed = extension === ".csv"
    ? { format: "csv", data: parseCsv(text) }
    : parseJson(text);
  const model = buildDocumentModel(parsed.data, parsed.format, sourcePath);
  return resolveEntryActionRow(model, collectionPath, sourceRowIndex, rowId);
}

export function assertProjectSkillResultPolicy(result, resultPolicy) {
  if (resultPolicy === "result-only") {
    if (result?.kind !== "project-skill-result" || result?.resultOnly !== true) throw protocolError("PROJECT_SKILL_RESULT_INVALID", "Project skill must return a result-only object.");
    resolveResultOnlyStatus(result);
    return;
  }
  if (resultPolicy === "proposal") {
    if (isProjectSkillResultOnly(result)) { resolveResultOnlyStatus(result); return; }
    if (!result || result.resultOnly === true || Object.hasOwn(result, "humanNotes") || !["entry-action-proposal", "candidate-create"].includes(result.kind)) throw protocolError("PROJECT_SKILL_RESULT_INVALID", "Project skill must return an admitted proposal result without humanNotes.");
    if (result.kind === "entry-action-proposal") resolveProposalResultStatusDetails(result);
    try { validateEntryActionEvidence(result.evidence); }
    catch { throw protocolError("PROJECT_SKILL_RESULT_INVALID", "Project-skill proposal evidence is invalid."); }
    return;
  }
  throw protocolError("PROJECT_SKILL_RESULT_POLICY_INVALID", "Project skill result policy is invalid.");
}

// A proposal-capable skill may legitimately conclude that no canonical write is allowed.
// Its structured execution status determines completion; it is not a write proposal.
function isProjectSkillResultOnly(result) {
  return result?.kind === "project-skill-result" && result?.resultOnly === true;
}

async function runPreflight({ binding, workspaceRoot, outputRoot, sourcePath, collectionPath, rowId, sourceRowIndex, preflightId, dependencies }) {
  if (!binding) throw protocolError("PROJECT_SKILL_PREFLIGHT_BINDING_MISSING", `No local preflight binding exists for: ${preflightId}`);
  const interpreter = await realpath(binding.interpreter).catch(() => null);
  const script = await realpath(binding.script).catch(() => null);
  if (!interpreter || !script) throw protocolError("PROJECT_SKILL_PREFLIGHT_BINDING_INVALID", "Local preflight interpreter or script is unavailable.");
  const digest = crypto.createHash("sha256").update(await readFile(script)).digest("hex");
  if (digest !== binding.sha256) throw protocolError("PROJECT_SKILL_PREFLIGHT_BINDING_INVALID", "Local preflight script has changed and must be confirmed again.");
  const args = [script, "--input-root", workspaceRoot, "--source-path", sourcePath, "--collection-path", collectionPath, "--row-id", rowId ?? "", "--source-row-index", sourceRowIndex == null ? "" : String(sourceRowIndex)];
  const runner = dependencies.runPreflight ?? runPreflightProcess;
  const result = await runner({ command: interpreter, args, cwd: workspaceRoot, timeoutMs: binding.timeoutMs, stdoutPath: path.join(outputRoot, "preflight.stdout.log"), stderrPath: path.join(outputRoot, "preflight.stderr.log") });
  if (result?.timedOut) throw protocolError("PROJECT_SKILL_PREFLIGHT_TIMED_OUT", "Project preflight timed out.");
  if (result?.exitCode !== 0) throw protocolError("PROJECT_SKILL_PREFLIGHT_FAILED", `Project preflight exited with code ${result?.exitCode ?? "unknown"}.`);
}

async function runPreflightProcess({ command, args, cwd, timeoutMs, stdoutPath, stderrPath }) {
  const { spawn } = await import("node:child_process");
  const started=await withHistoricalScopeEffect(()=>({completion:new Promise((resolve, reject) => {
    const stdout = createWriteStream(stdoutPath);
    const stderr = createWriteStream(stderrPath);
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", stdout, stderr] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once("error", reject);
    child.once("close", (exitCode) => { clearTimeout(timer); resolve({ exitCode, timedOut }); });
  })}));
  return started.completion;
}

function resolveProjectSkillResultStatus(result) { return resolveResultOnlyStatus(result); }

function resolveProjectSkillResultMessage(result) {
  for (const value of [result?.summary, result?.message, result?.result?.summary, result?.result?.message]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Project skill completed.";
}

async function publishProjectSkillTerminal(projectContext, runId, actionId, outcome, message, details = {}) {
  return publishEntryActionResultIdempotently(projectContext, runId, {
    version: 3,
    runId,
    actionId,
    phase: "terminal",
    outcome,
    terminalAt: new Date().toISOString(),
    message,
    ...details,
  });
}

async function copyDiagnostics(sourcePath, targetPath) {
  const text = await readFile(sourcePath, "utf8");
  await atomicWrite(targetPath, text);
}

function protocolError(code, message) { return Object.assign(new Error(message), { code, status: 400 }); }

export const startProjectSkillEntryAction = publicationStart(startProjectSkillEntryActionImplementation, input => input.dependencies?.followupRunId ?? input.dependencies?.runId);
