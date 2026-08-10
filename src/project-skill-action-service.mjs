import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { loadAutomationBindings } from "./automation-bindings.mjs";
import { loadAutomationProfile } from "./automation-profile.mjs";
import { resolveAutomationExecutionConfig } from "./automation-runtime.mjs";
import { resolveCodexBindingStatus } from "./codex-runtime.mjs";
import {
  advanceEntryActionPhase,
  buildEntryActionHandoff,
  entryActionDiagnosticsPath,
  entryActionOutputPath,
  findAutomationEntryAction,
  publishEntryActionResultIdempotently,
  writeEntryActionHandoff,
  writeEntryActionStarted,
} from "./entry-actions.mjs";
import { atomicWrite } from "./atomic-file.mjs";
import { validateEntryActionEvidence } from "./entry-action-evidence.mjs";

export async function startProjectSkillEntryAction({ projectContext, project, request, toolRoot, jobSupervisor, dependencies = {} }) {
  const [profile, bindings] = await Promise.all([loadAutomationProfile(projectContext), loadAutomationBindings(projectContext)]);
  const action = findAutomationEntryAction(profile, String(request.actionId ?? "").trim());
  if (action.execution?.kind !== "project-skill") throw protocolError("PROJECT_SKILL_EXECUTION_REQUIRED", "Action is not a project-skill.");
  const binding = bindings.bindings?.[action.id];
  const status = await (dependencies.resolveBindingStatus ?? resolveCodexBindingStatus)(binding, { projectRoot: projectContext.projectRoot });
  if (status.status !== "ready") throw protocolError("ENTRY_ACTION_BINDING_INVALID", status.message ?? "Automation binding is unavailable.");
  const runtime = resolveAutomationExecutionConfig({ rule: action, binding, defaults: bindings.defaults }).runtime;
  const runId = crypto.randomUUID();
  const scratch = path.join(os.tmpdir(), `data-editor-project-skill-${runId}`);
  const inputRoot = path.join(scratch, "input");
  const outputRoot = path.join(scratch, "output");
  const sourcePath = String(request.sourcePath ?? "").trim();
  const collectionPath = String(request.collectionPath ?? "").trim();
  const rowId = typeof request.rowId === "string" ? request.rowId.trim() : null;
  const sourceRowIndex = Number.isInteger(request.sourceRowIndex) ? request.sourceRowIndex : null;
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
    row: null,
    previousRow: null,
    nextRow: null,
    rowCount: null,
  });
  await writeEntryActionHandoff(projectContext, runId, handoff);
  await writeEntryActionStarted(projectContext, runId, {
    version: 2,
    runId,
    actionId: action.id,
    phase: "queued",
    outcome: null,
    startedAt: new Date().toISOString(),
  });

  let handle;
  let promptPath;
  let replyPath;
  let eventsPath;
  let diagnosticsPath;
  try {
    await mkdir(scratch, { recursive: false });
    await (dependencies.prepareInputRoot ?? copyProjectSnapshot)(projectContext.projectRoot, inputRoot);
    await mkdir(outputRoot, { recursive: false });
    promptPath = path.join(outputRoot, "prompt.md");
    replyPath = path.join(outputRoot, "reply.json");
    eventsPath = path.join(outputRoot, "events.jsonl");
    diagnosticsPath = path.join(outputRoot, "diagnostics.log");
    const skill = await readFile(status.skillPath, "utf8");
    const resultPolicy = action.execution.resultPolicy;
    await writeFile(promptPath, `${skill}\n\n## Explicit invocation\nProject input is a disposable read-only snapshot at ${JSON.stringify(inputRoot)}. Write task-owned output only under ${JSON.stringify(outputRoot)}. Return exactly one JSON object allowed by resultPolicy=${JSON.stringify(resultPolicy)}.\n${JSON.stringify({ actionId: action.id, projectId: project.id, resultPolicy, request }, null, 2)}\n`, "utf8");
    handle = await jobSupervisor.start({ id: runId, command: process.execPath, args: [path.resolve(toolRoot, "scripts/run-project-skill-action-host.mjs"), "--codex", status.codexCliPath, "--input-root", inputRoot, "--output-root", outputRoot, "--prompt", promptPath, "--reply", replyPath, "--events", eventsPath, "--diagnostics", diagnosticsPath, "--model", runtime.model, "--reasoning", runtime.reasoning, "--verbosity", runtime.verbosity], cwd: outputRoot, timeoutMs: runtime.timeoutMs });
    await advanceEntryActionPhase(projectContext, runId, "running");
  } catch (error) {
    await publishProjectSkillTerminal(projectContext, runId, action.id, "failed", error.message ?? String(error));
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  const completion = (async () => {
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
        if (typeof dependencies.submitProposalResult !== "function") throw protocolError("PROJECT_SKILL_PROPOSAL_ADMISSION_UNAVAILABLE", "Project-skill proposal admission is unavailable.");
        const admitted = await dependencies.submitProposalResult({ projectContext, project, request, action, profile, runId, result });
        await publishProjectSkillTerminal(projectContext, runId, action.id, "completed_with_writeback", resolveProjectSkillResultMessage(result), { admittedRunId: admitted.runId, admittedKind: admitted.kind });
        return admitted;
      }
      if (action.execution.resultPolicy === "project-transaction") {
        if (typeof dependencies.submitProjectTransactionResult !== "function") throw protocolError("PROJECT_TRANSACTION_OWNER_UNAVAILABLE", "Project transaction admission is unavailable.");
        const transaction = await dependencies.submitProjectTransactionResult({ projectContext, project, request, action, profile, runId, result });
        if (transaction.pending === true) return transaction;
        await publishProjectSkillTerminal(projectContext, runId, action.id, transaction.changed ? "completed_with_writeback" : "completed_without_changes", transaction.message, { transactionReceipt: transaction.receipt });
        return transaction;
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
    } finally { await rm(scratch, { recursive: true, force: true }).catch(() => {}); }
  })();
  return { runId, completion };
}

export function assertProjectSkillResultPolicy(result, resultPolicy) {
  if (resultPolicy === "result-only") {
    if (result?.kind !== "project-skill-result" || result?.resultOnly !== true) throw protocolError("PROJECT_SKILL_RESULT_INVALID", "Project skill must return a result-only object.");
    return;
  }
  if (resultPolicy === "proposal") {
    if (!result || result.resultOnly === true || Object.hasOwn(result, "humanNotes") || !["entry-action-proposal", "candidate-create"].includes(result.kind)) throw protocolError("PROJECT_SKILL_RESULT_INVALID", "Project skill must return an admitted proposal result without humanNotes.");
    try { validateEntryActionEvidence(result.evidence); }
    catch { throw protocolError("PROJECT_SKILL_RESULT_INVALID", "Project-skill proposal evidence is invalid."); }
    return;
  }
  if (resultPolicy === "project-transaction") {
    if (result?.kind !== "project-transaction-result") throw protocolError("PROJECT_SKILL_RESULT_INVALID", "Project skill must return a project transaction result.");
    return;
  }
  throw protocolError("PROJECT_SKILL_RESULT_POLICY_INVALID", "Project skill result policy is invalid.");
}

async function copyProjectSnapshot(projectRoot, inputRoot) {
  await cp(projectRoot, inputRoot, {
    recursive: true,
    force: false,
    errorOnExist: true,
    async filter(source) {
      const relative = path.relative(projectRoot, source).replaceAll("\\", "/");
      const included = relative !== ".data-editor/runtime" && !relative.startsWith(".data-editor/runtime/")
        && relative !== ".data-editor/logs" && !relative.startsWith(".data-editor/logs/");
      if (!included) return false;
      const stat = await lstat(source);
      if (stat.isSymbolicLink()) throw protocolError("PROJECT_SKILL_INPUT_LINK_UNSUPPORTED", "Project snapshot contains a symbolic link or junction.");
      return true;
    },
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
    version: 2,
    runId,
    actionId,
    phase: "terminal",
    outcome,
    message,
    ...details,
  });
}

async function copyDiagnostics(sourcePath, targetPath) {
  const text = await readFile(sourcePath, "utf8");
  await atomicWrite(targetPath, text);
}

function protocolError(code, message) { return Object.assign(new Error(message), { code, status: 400 }); }
