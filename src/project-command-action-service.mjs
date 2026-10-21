import { spawn } from "node:child_process";
import path from "node:path";
import { buildDocumentModel } from "./document-model.mjs";
import { parseCsv } from "./csv-codec.mjs";
import { canonicalFileIdentity } from "./canonical-file-identity.mjs";
import { loadAutomationProfile } from "./automation-profile.mjs";
import { readTextFile, resolveDataFilePath } from "./file-service.mjs";
import { resolveInsideRoot } from "./project-context.mjs";
import { realpath } from "node:fs/promises";
import { readServiceProcessIdentity } from "./service-process-identity.mjs";
import { rowDigest } from "./row-digest.mjs";
import { findAutomationEntryAction, validateEntryActionTarget, resolveEntryActionRow, createEntryActionRunId, writeEntryActionHandoff, writeEntryActionStarted, publishEntryActionResultIdempotently } from "./entry-actions.mjs";
import { submitFreshEntryActionProposal } from "./entry-action-service.mjs";
import { captureProjectCommandSnapshot, assertProjectCommandSnapshot, projectCommandFile, commandError } from "./project-command-snapshot.mjs";

/** A fixed project declaration, never a client-supplied command or shell. */
export async function executeProjectCommand(context, command, input) {
  const script = await projectCommandFile(context, command.path);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...command.args], { cwd: context.projectRoot, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", failure = null;
    const timer = setTimeout(() => { failure = commandError("PROJECT_COMMAND_TIMEOUT"); child.kill(); }, command.timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk; if (Buffer.byteLength(stdout) > 1024 * 1024) { failure = commandError("PROJECT_COMMAND_OUTPUT_LIMIT"); child.kill(); } });
    child.stderr.on("data", chunk => { if (stderr.length < 16384) stderr += chunk; });
    child.stdin.on("error", () => {});
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (code !== 0) return reject(commandError("PROJECT_COMMAND_FAILED", stderr || `Project command exited ${code}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(commandError("PROJECT_COMMAND_RESULT_INVALID")); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export async function startProjectCommandEntryAction({ projectContext, project, request, documentCommitCoordinator }) {
  const profile = await loadAutomationProfile(projectContext);
  const action = findAutomationEntryAction(profile, request.actionId);
  if (action.execution.kind !== "project-command") throw commandError("PROJECT_COMMAND_ADMISSION_REQUIRED");
  validateEntryActionTarget(action, request.sourcePath, request.collectionPath);
  resolveInsideRoot(await realpath(projectContext.projectRoot), await realpath(resolveDataFilePath(projectContext, request.sourcePath)));
  const text = await readTextFile(projectContext, request.sourcePath);
  const root = path.extname(request.sourcePath).toLowerCase() === ".csv" ? parseCsv(text) : JSON.parse(text);
  const row = resolveEntryActionRow(buildDocumentModel(root, "json", request.sourcePath), request.collectionPath, null, request.rowId).row;
  if (!request.rowId || rowDigest(row) !== request.expectedRowDigest) throw commandError("PROJECT_COMMAND_TARGET_STALE");
  if (!Array.isArray(request.locales ?? []) || (request.locales ?? []).some(locale => typeof locale !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(locale))) throw commandError("PROJECT_COMMAND_LOCALES_INVALID");
  const baseline = await captureProjectCommandSnapshot(projectContext, { sourcePath: request.sourcePath, documentText: text, command: action.execution.command, action });
  const identity = await canonicalFileIdentity(projectContext, request.sourcePath);
  const runId = createEntryActionRunId(), acceptedAt = new Date().toISOString();
  const writer = await readServiceProcessIdentity();
  if (!writer) throw commandError("PROJECT_COMMAND_WRITER_IDENTITY_UNAVAILABLE");
  await writeEntryActionHandoff(projectContext, runId, { version: 2, runId, createdAt: acceptedAt, action: { id: action.id, execution: action.execution }, entry: { sourcePath: request.sourcePath, canonicalFileKey: identity.canonicalFileKey, collectionPath: request.collectionPath, rowId: request.rowId }, projectCommand: { writer, baseline, baseDocumentEtag: baseline.baseDocumentEtag, readDependencies: baseline.files.map(({ path, digest }) => ({ path, digest })) } });
  await writeEntryActionStarted(projectContext, runId, { version: 2, runId, actionId: action.id, startedAt: acceptedAt, phase: "running", outcome: null });
  const completion = (async () => {
    try {
      const result = await executeProjectCommand(projectContext, action.execution.command, { version: 1, entry: { sourcePath: request.sourcePath, collectionPath: request.collectionPath, rowId: request.rowId, row: structuredClone(row) }, locales: request.locales ?? [], snapshot: { baseDocumentEtag: baseline.baseDocumentEtag, readDependencies: baseline.files.filter(item => item.path).map(({ path, digest }) => ({ path, digest })) } });
      await assertProjectCommandSnapshot(projectContext, baseline, await readTextFile(projectContext, request.sourcePath));
      if (result?.kind === "project-command-result" && ["no_changes", "failed"].includes(result.status)) {
        await publishEntryActionResultIdempotently(projectContext, runId, { version: 2, runId, actionId: action.id, phase: "terminal", outcome: result.status === "no_changes" ? "completed_without_changes" : "failed", resultStatus: result.status, message: String(result.summary ?? result.status) });
        return;
      }
      if (result?.kind !== "entry-action-proposal" || Object.keys(result).some(key => !["kind", "changes", "summary", "evidence"].includes(key))) throw commandError("PROJECT_COMMAND_RESULT_INVALID");
      return await submitFreshEntryActionProposal({ projectContext, project, request, result, documentCommitCoordinator, dependencies: { runId, projectCommandBaseline: baseline } });
    } catch (error) {
      // Existing journal recovery owns ambiguous commits; never overwrite its result.
      if (!/RECOVERY|UNKNOWN|OWNERSHIP/.test(error?.code ?? "")) await publishEntryActionResultIdempotently(projectContext, runId, { version: 2, runId, actionId: action.id, phase: "terminal", outcome: /STALE/.test(error?.code ?? "") ? "conflicted" : "failed", message: error.message }).catch(() => {});
      throw error;
    }
  })();
  return { runId, acceptedAt, phase: "running", completion };
}
