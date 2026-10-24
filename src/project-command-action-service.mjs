import { publicationStart, publicationSubmit, publicationRecovery, publicationExistingOperation, publicationConfigWrite, publicationObserve, publicationIsOpen } from './publication-window-runtime.mjs';
import path from "node:path";
import { executeProjectCommand } from "./project-command-runner.mjs";
import { validateProjectCommandResult } from "./project-command-validator.mjs";
import { createDocumentCommitCoordinator } from "./document-commit-coordinator.mjs";
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
import { captureProjectCommandSnapshot, assertProjectCommandSnapshot, projectCommandCommitIdentities, commandError } from "./project-command-snapshot.mjs";

export { executeProjectCommand } from "./project-command-runner.mjs";

async function startProjectCommandEntryActionImplementation({ projectContext, project, request, publicationRunId, documentCommitCoordinator = createDocumentCommitCoordinator() }) {
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
  const runId = publicationRunId ?? createEntryActionRunId(), acceptedAt = new Date().toISOString();
  const requestContext = { version: 1, runId, actionId: action.id, sourcePath: request.sourcePath, collectionPath: request.collectionPath, rowId: request.rowId, locales: [...(request.locales ?? [])] };
  const baseline = await captureProjectCommandSnapshot(projectContext, { sourcePath: request.sourcePath, documentText: text, command: action.execution.command, action, requestContext });
  const identity = await canonicalFileIdentity(projectContext, request.sourcePath);
  const writer = await readServiceProcessIdentity();
  if (!writer) throw commandError("PROJECT_COMMAND_WRITER_IDENTITY_UNAVAILABLE");
  await writeEntryActionHandoff(projectContext, runId, { version: 2, runId, createdAt: acceptedAt, action: { id: action.id, execution: action.execution }, entry: { sourcePath: request.sourcePath, canonicalFileKey: identity.canonicalFileKey, collectionPath: request.collectionPath, rowId: request.rowId }, projectCommand: { writer, baseline, baseDocumentEtag: baseline.baseDocumentEtag, readDependencies: baseline.files.map(({ path, digest }) => ({ path, digest })) } });
  await writeEntryActionStarted(projectContext, runId, { version: 2, runId, actionId: action.id, startedAt: acceptedAt, phase: "running", outcome: null });
  const completion = (async () => {
    try {
      const result = await executeProjectCommand(projectContext, action.execution.command, { version: 1, entry: { sourcePath: request.sourcePath, collectionPath: request.collectionPath, rowId: request.rowId, row: structuredClone(row) }, locales: requestContext.locales, snapshot: { baseDocumentEtag: baseline.baseDocumentEtag, readDependencies: baseline.files.filter(item => item.path).map(({ path, digest }) => ({ path, digest })) } });
      await assertProjectCommandSnapshot(projectContext, baseline, await readTextFile(projectContext, request.sourcePath));
      if (result?.kind === "project-command-result" && ["no_changes", "failed"].includes(result.status)) {
        if (result.status === "no_changes" && action.execution.proposalValidator) {
          await documentCommitCoordinator.withIdentities(await projectCommandCommitIdentities(projectContext, baseline), async () => {
            await assertProjectCommandSnapshot(projectContext, baseline, await readTextFile(projectContext, requestContext.sourcePath));
            await validateProjectCommandResult({ context: projectContext, action, baseline, runId, mode: "no_changes", changes: [] });
            await assertProjectCommandSnapshot(projectContext, baseline, await readTextFile(projectContext, requestContext.sourcePath));
            await publishEntryActionResultIdempotently(projectContext, runId, { version: 2, runId, actionId: action.id, phase: "terminal", outcome: "completed_without_changes", resultStatus: "no_changes", message: String(result.summary ?? result.status) });
          });
          return;
        }
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

export const startProjectCommandEntryAction = publicationStart(startProjectCommandEntryActionImplementation);
