import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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

export async function startProjectSkillEntryAction({ projectContext, project, request, toolRoot, jobSupervisor, dependencies = {} }) {
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
  const runId = crypto.randomUUID();
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
  if (action.execution.resultPolicy === "proposal") {
    handoff.projectSkillProposal = {
      envelope: "entry-action-proposal.v1",
      requiredKeys: ["kind", "changes", "textArtifact", "summary", "evidence"],
      writableFields: null,
    };
  }
  await writeEntryActionHandoff(projectContext, runId, handoff);
  const acceptedAt = new Date().toISOString();
  await writeEntryActionStarted(projectContext, runId, {
    version: 3,
    runId,
    actionId: action.id,
    phase: "queued",
    outcome: null,
    startedAt: acceptedAt,
    phaseStartedAt: acceptedAt,
    phaseHistory: [{ phase: "queued", startedAt: acceptedAt }],
  });

  const completion = continueProjectSkillEntryAction({
    projectContext, project, request, toolRoot, jobSupervisor, dependencies,
    action, profile, bindings, workspaceMode, projectInput, preflightId, sourcePath, collectionPath,
    binding, status, skill, skillDigest, runtime, runId, scratch, snapshotRoot, outputRoot, rowId, sourceRowIndex, artifactPublication, handoff,
  });
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
      ? "For a write proposal, return exactly {\\\"kind\\\":\\\"entry-action-proposal\\\",\\\"changes\\\":[...],\\\"textArtifact\\\":null,\\\"summary\\\":\\\"...\\\",\\\"evidence\\\":[]}. Each change must contain field, beforeExists, before, afterExists, after. Do not include authority tokens or humanNotes: Data Editor binds them from the canonical target after execution. If no safe change is possible, return exactly {\\\"kind\\\":\\\"project-skill-result\\\",\\\"resultOnly\\\":true,\\\"status\\\":\\\"no_changes\\\",\\\"summary\\\":\\\"...\\\"}."
      : "Return exactly one JSON object allowed by the configured result policy.";
    await writeFile(promptPath, `${skill}\n\n## Explicit invocation\n${workspaceInstructions}\n${proposalInstruction}\n${JSON.stringify({ actionId: action.id, projectId: project.id, execution: action.execution, resultPolicy, workspaceMode, request, skillArtifact: { logicalName: binding.skill, sha256: skillDigest }, artifactPublication }, null, 2)}\n\n## Data Editor handoff\n${JSON.stringify(handoff, null, 2)}\n`, "utf8");
    const hostArgs = [path.resolve(toolRoot, "scripts/run-project-skill-action-host.mjs"), "--codex", status.codexCliPath, "--workspace-root", workspaceRoot, "--output-root", outputRoot, "--prompt", promptPath, "--reply", replyPath, "--events", eventsPath, "--diagnostics", diagnosticsPath, "--model", runtime.model, "--reasoning", runtime.reasoning, "--verbosity", runtime.verbosity];
    if (workspaceMode === "snapshot") hostArgs.push("--ignore-rules");
    handle = await jobSupervisor.start({ id: runId, command: process.execPath, args: hostArgs, cwd: workspaceRoot, timeoutMs: runtime.timeoutMs });
    await advanceEntryActionPhase(projectContext, runId, "running");
  } catch (error) {
    const outcome = error?.code === "PROJECT_SKILL_PREPARATION_TIMED_OUT" ? "preparation_timed_out"
      : error?.code === "PROJECT_SKILL_PREPARATION_FAILED" ? "preparation_failed"
      : error?.code === "PROJECT_SKILL_PREFLIGHT_TIMED_OUT" ? "preflight_timed_out"
      : error?.code === "PROJECT_SKILL_PREFLIGHT_FAILED" ? "preflight_failed"
        : "failed";
    await publishProjectSkillTerminal(projectContext, runId, action.id, outcome, error.message ?? String(error));
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
    if (workspaceMode === "project-write") await rm(outputRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  try {
      const terminal = await handle.completion;
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
      if (action.execution.resultPolicy === "proposal") {
        if (isProjectSkillNoChangeResult(result)) {
          await publishProjectSkillTerminal(
            projectContext,
            runId,
            action.id,
            "completed_without_changes",
            resolveProjectSkillResultMessage(result),
            { outputPath, resultOnly: true, resultStatus: resolveProjectSkillResultStatus(result) },
          );
          return result;
        }
        if (typeof dependencies.submitProposalResult !== "function") throw protocolError("PROJECT_SKILL_PROPOSAL_ADMISSION_UNAVAILABLE", "Project-skill proposal admission is unavailable.");
        await advanceEntryActionPhase(projectContext, runId, "proposal_ready");
        const admitted = await dependencies.submitProposalResult({ projectContext, project, request, action, profile, runId, result });
        // Same-run admission publishes the terminal receipt as part of its
        // commit. A second publication would violate idempotency.
        if (admitted.runId !== runId) {
          await publishProjectSkillTerminal(projectContext, runId, action.id, "completed_with_writeback", resolveProjectSkillResultMessage(result), { admittedRunId: admitted.runId, admittedKind: admitted.kind });
        }
        return admitted;
      }
      await publishProjectSkillTerminal(
        projectContext,
        runId,
        action.id,
        "completed_without_changes",
        resolveProjectSkillResultMessage(result),
        {
          outputPath,
          resultOnly: action.execution.resultPolicy === "result-only",
          resultStatus: resolveProjectSkillResultStatus(result),
        },
      );
      return result;
  } catch (error) {
      await copyDiagnostics(diagnosticsPath, entryActionDiagnosticsPath(projectContext, runId)).catch(() => {});
      await publishProjectSkillTerminal(projectContext, runId, action.id, "failed", error.message ?? String(error)).catch(() => {});
    throw error;
  } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
      if (workspaceMode === "project-write") await rm(outputRoot, { recursive: true, force: true }).catch(() => {});
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
    return;
  }
  if (resultPolicy === "proposal") {
    if (isProjectSkillNoChangeResult(result)) return;
    if (!result || result.resultOnly === true || Object.hasOwn(result, "humanNotes") || !["entry-action-proposal", "candidate-create"].includes(result.kind)) throw protocolError("PROJECT_SKILL_RESULT_INVALID", "Project skill must return an admitted proposal result without humanNotes.");
    try { validateEntryActionEvidence(result.evidence); }
    catch { throw protocolError("PROJECT_SKILL_RESULT_INVALID", "Project-skill proposal evidence is invalid."); }
    return;
  }
  throw protocolError("PROJECT_SKILL_RESULT_POLICY_INVALID", "Project skill result policy is invalid.");
}

// A proposal-capable skill may legitimately conclude that no canonical write is allowed.
// Treat that as a completed report, not as an incomplete proposal submission.
function isProjectSkillNoChangeResult(result) {
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
  return new Promise((resolve, reject) => {
    const stdout = createWriteStream(stdoutPath);
    const stderr = createWriteStream(stderrPath);
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", stdout, stderr] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once("error", reject);
    child.once("close", (exitCode) => { clearTimeout(timer); resolve({ exitCode, timedOut }); });
  });
}

function resolveProjectSkillResultStatus(result) {
  for (const value of [
    result?.status,
    result?.designVerdict,
    result?.verdict,
    result?.result?.status,
    result?.result?.designVerdict,
    result?.result?.verdict,
  ]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

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
