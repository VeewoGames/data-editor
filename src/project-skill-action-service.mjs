import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
    promptPath = path.join(scratch, "prompt.md");
    replyPath = path.join(scratch, "reply.json");
    eventsPath = path.join(scratch, "events.jsonl");
    diagnosticsPath = path.join(scratch, "diagnostics.log");
    const skill = await readFile(status.skillPath, "utf8");
    await writeFile(promptPath, `${skill}\n\n## Explicit invocation\nReturn exactly one JSON object with {"kind":"project-skill-result","resultOnly":true}.\n${JSON.stringify({ actionId: action.id, projectId: project.id, request }, null, 2)}\n`, "utf8");
    handle = await jobSupervisor.start({ id: runId, command: process.execPath, args: [path.resolve(toolRoot, "scripts/run-project-skill-action-host.mjs"), "--codex", status.codexCliPath, "--project-root", projectContext.projectRoot, "--prompt", promptPath, "--reply", replyPath, "--events", eventsPath, "--diagnostics", diagnosticsPath, "--model", runtime.model, "--reasoning", runtime.reasoning, "--verbosity", runtime.verbosity], cwd: projectContext.projectRoot, timeoutMs: runtime.timeoutMs });
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
      await atomicWrite(entryActionOutputPath(projectContext, runId), reply);
      const result = JSON.parse(reply);
      if (result?.kind !== "project-skill-result" || result?.resultOnly !== true) throw protocolError("PROJECT_SKILL_RESULT_INVALID", "Project skill must return a result-only object.");
      await publishProjectSkillTerminal(projectContext, runId, action.id, "completed_without_changes", result.message ?? "Project skill completed.");
      return result;
    } catch (error) {
      await copyDiagnostics(diagnosticsPath, entryActionDiagnosticsPath(projectContext, runId)).catch(() => {});
      await publishProjectSkillTerminal(projectContext, runId, action.id, "failed", error.message ?? String(error)).catch(() => {});
      throw error;
    } finally { await rm(scratch, { recursive: true, force: true }).catch(() => {}); }
  })();
  return { runId, completion };
}

async function publishProjectSkillTerminal(projectContext, runId, actionId, outcome, message) {
  return publishEntryActionResultIdempotently(projectContext, runId, {
    version: 2,
    runId,
    actionId,
    phase: "terminal",
    outcome,
    message,
  });
}

async function copyDiagnostics(sourcePath, targetPath) {
  const text = await readFile(sourcePath, "utf8");
  await atomicWrite(targetPath, text);
}

function protocolError(code, message) { return Object.assign(new Error(message), { code, status: 400 }); }
