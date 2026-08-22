import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
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
  const requiresScopedTarget = projectInput != null || workspaceMode === "project-write";
  const sourcePath = requiresScopedTarget ? normalizeEntryActionPath(request.sourcePath, "sourcePath") : String(request.sourcePath ?? "").trim();
  const collectionPath = requiresScopedTarget ? normalizeEntryActionPath(request.collectionPath, "collectionPath") : String(request.collectionPath ?? "").trim();
  if (requiresScopedTarget) validateEntryActionTarget(action, sourcePath, collectionPath);
  const binding = bindings.bindings?.[action.id];
  const status = await (dependencies.resolveBindingStatus ?? resolveCodexBindingStatus)(binding, { projectRoot: projectContext.projectRoot });
  if (status.status !== "ready") throw protocolError("ENTRY_ACTION_BINDING_INVALID", status.message ?? "Automation binding is unavailable.");
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
    row: null,
    previousRow: null,
    nextRow: null,
    rowCount: null,
  });
  await writeEntryActionHandoff(projectContext, runId, handoff);
  await writeEntryActionStarted(projectContext, runId, {
    version: 3,
    runId,
    actionId: action.id,
    phase: "queued",
    outcome: null,
    startedAt: new Date().toISOString(),
    phaseStartedAt: new Date().toISOString(),
    phaseHistory: [{ phase: "queued", startedAt: new Date().toISOString() }],
  });

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
      if (projectInput) await advanceEntryActionPhase(projectContext, runId, "preparing_input");
      await (dependencies.prepareInputRoot ?? (projectInput ? copyDeclaredProjectInput : copyProjectSnapshot))(
        projectContext.projectRoot,
        workspaceRoot,
        projectInput,
        sourcePath,
      );
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
    const skill = await readFile(status.skillPath, "utf8");
    const resultPolicy = action.execution.resultPolicy;
    const shellInstruction = "Use Codex's built-in shell tool. Do not explicitly invoke an absolute path to pwsh.exe, powershell.exe, cmd.exe, or another command interpreter.";
    const workspaceInstructions = workspaceMode === "project-write"
      ? `Project workspace is the real project root at ${JSON.stringify(workspaceRoot)}. Follow the project's own instructions and only change files owned by this project skill. Data Editor diagnostics and the required JSON reply belong under ${JSON.stringify(outputRoot)}. ${shellInstruction}`
      : `Project workspace is a disposable read-only snapshot at ${JSON.stringify(workspaceRoot)}. Do not treat changes there as project output. Write task-owned output only under ${JSON.stringify(outputRoot)}. ${shellInstruction}`;
    await writeFile(promptPath, `${skill}\n\n## Explicit invocation\n${workspaceInstructions}\nReturn exactly one JSON object allowed by resultPolicy=${JSON.stringify(resultPolicy)}.\n${JSON.stringify({ actionId: action.id, projectId: project.id, execution: action.execution, resultPolicy, workspaceMode, request, artifactPublication }, null, 2)}\n`, "utf8");
    const hostArgs = [path.resolve(toolRoot, "scripts/run-project-skill-action-host.mjs"), "--codex", status.codexCliPath, "--workspace-root", workspaceRoot, "--output-root", outputRoot, "--prompt", promptPath, "--reply", replyPath, "--events", eventsPath, "--diagnostics", diagnosticsPath, "--model", runtime.model, "--reasoning", runtime.reasoning, "--verbosity", runtime.verbosity];
    if (workspaceMode === "snapshot") hostArgs.push("--ignore-rules");
    handle = await jobSupervisor.start({ id: runId, command: process.execPath, args: hostArgs, cwd: workspaceRoot, timeoutMs: runtime.timeoutMs });
    await advanceEntryActionPhase(projectContext, runId, projectInput || preflightId ? "review_running" : "running");
  } catch (error) {
    const outcome = error?.code === "PROJECT_SKILL_PREFLIGHT_TIMED_OUT" ? "preflight_timed_out"
      : error?.code === "PROJECT_SKILL_PREFLIGHT_FAILED" ? "preflight_failed"
        : "failed";
    await publishProjectSkillTerminal(projectContext, runId, action.id, outcome, error.message ?? String(error));
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
    if (workspaceMode === "project-write") await rm(outputRoot, { recursive: true, force: true }).catch(() => {});
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
        const admitted = await dependencies.submitProposalResult({ projectContext, project, request, action, profile, runId, result });
        await publishProjectSkillTerminal(projectContext, runId, action.id, "completed_with_writeback", resolveProjectSkillResultMessage(result), { admittedRunId: admitted.runId, admittedKind: admitted.kind });
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
  })();
  return { runId, completion };
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
      // Linked assistant-skill aliases are already supplied by the bound skill path.
      // Never follow them into a project snapshot, but retain the hard boundary for project links.
      if (stat.isSymbolicLink() && isAssistantSkillAlias(relative)) return false;
      if (stat.isSymbolicLink()) throw protocolError("PROJECT_SKILL_INPUT_LINK_UNSUPPORTED", "Project snapshot contains a symbolic link or junction.");
      return true;
    },
  });
}

async function copyDeclaredProjectInput(projectRoot, inputRoot, projectInput, sourcePath) {
  if (!projectInput?.paths?.some((item) => sourcePath === item || sourcePath.startsWith(`${item}/`))) {
    throw protocolError("PROJECT_SKILL_INPUT_TARGET_UNDECLARED", `Project input does not cover action target: ${sourcePath}`);
  }
  await mkdir(inputRoot, { recursive: false });
  for (const relative of projectInput.paths) {
    const source = path.resolve(projectRoot, relative);
    const resolved = await realpath(source).catch(() => null);
    if (!resolved || !isInside(projectRoot, resolved)) throw protocolError("PROJECT_SKILL_INPUT_PATH_INVALID", `Project input path is unavailable: ${relative}`);
    const stat = await lstat(source);
    if (stat.isSymbolicLink()) throw protocolError("PROJECT_SKILL_INPUT_LINK_UNSUPPORTED", "Project input contains a symbolic link or junction.");
    await assertProjectInputHasNoLinks(source);
    const target = path.join(inputRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: stat.isDirectory(), force: false, errorOnExist: true, dereference: false });
  }
}

async function assertProjectInputHasNoLinks(target) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) throw protocolError("PROJECT_SKILL_INPUT_LINK_UNSUPPORTED", "Project input contains a symbolic link or junction.");
  if (!stat.isDirectory()) return;
  for (const entry of await readdir(target)) {
    await assertProjectInputHasNoLinks(path.join(target, entry));
  }
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

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isAssistantSkillAlias(relativePath) {
  return /^\.(?:agents|claude|codex)\/skills\/[^/]+(?:\/|$)/.test(relativePath);
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
