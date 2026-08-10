import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import { atomicWrite } from "./atomic-file.mjs";
import { loadAutomationBindings } from "./automation-bindings.mjs";
import { loadAutomationProfile } from "./automation-profile.mjs";
import { resolveAutomationExecutionConfig } from "./automation-runtime.mjs";
import { canonicalFileIdentity } from "./canonical-file-identity.mjs";
import { canonicalProjectArtifactIdentity } from "./canonical-project-artifact-identity.mjs";
import { resolveCodexBindingStatus } from "./codex-runtime.mjs";
import { createCommitJournal } from "./commit-journal.mjs";
import { createDocumentCommitCoordinator } from "./document-commit-coordinator.mjs";
import { buildDocumentModel } from "./document-model.mjs";
import {
  assertAuthorityCurrent,
  createAuthoritySnapshot,
} from "./entry-action-authority.mjs";
import { resolveEntryActionDocumentTarget } from "./entry-action-document-target.mjs";
import { assertEntryActionResultPolicies, loadEntryActionContracts, resolveEntryActionContract } from "./entry-action-contracts.mjs";
import {
  commitEntryActionGroup,
  createEntryActionGroupJournalEntry,
} from "./entry-action-group-commit.mjs";
import { createEntryActionGroupJournal } from "./entry-action-group-journal.mjs";
import { migrateLegacyEntryActionPolicy } from "./entry-action-policy-migration.mjs";
import { buildEntryActionProposalPrompt } from "./entry-action-proposal-prompt.mjs";
import {
  commitEntryActionProposal,
  prepareEntryActionProposalCommit,
} from "./entry-action-proposal-commit.mjs";
import { publishEntryActionProposal } from "./entry-action-proposal-publisher.mjs";
import {
  advanceEntryActionPhase,
  createEntryActionRunId,
  entryActionDiagnosticsPath,
  entryActionOutputPath,
  entryActionProposalPath,
  findAutomationEntryAction,
  normalizeEntryActionPath,
  normalizeEntryActionRowId,
  normalizeEntryActionSourceRowIndex,
  publishEntryActionResultIdempotently,
  resolveAutomationEntryActionBinding,
  resolveEntryActionRow,
  validateEntryActionTarget,
  writeEntryActionHandoff,
  writeEntryActionStarted,
} from "./entry-actions.mjs";
import { createFencingAllocator } from "./fencing-lock.mjs";
import { readTextFile, writeTextFile } from "./file-service.mjs";
import { parseCsv } from "./csv-codec.mjs";
import { parseJson } from "./json-codec.mjs";
import { resolveInsideRoot } from "./project-context.mjs";
import { rowDigest } from "./row-digest.mjs";
import { loadViewConfig } from "./view-config.mjs";

export async function startProposalOnlyEntryAction({
  projectContext,
  project,
  request,
  toolRoot,
  jobSupervisor,
  documentCommitCoordinator,
  dependencies = {},
}) {
  const resolveBindingStatus = dependencies.resolveCodexBindingStatus ?? resolveCodexBindingStatus;
  const createAllocator = dependencies.createFencingAllocator ?? createFencingAllocator;
  const actionId = String(request.actionId ?? "").trim();
  await migrateLegacyEntryActionPolicy(projectContext);
  const [profile, bindings, viewConfig, contractRegistry] = await Promise.all([
    loadAutomationProfile(projectContext),
    loadAutomationBindings(projectContext),
    loadViewConfig(projectContext),
    loadEntryActionContracts(projectContext),
  ]);
  const action = findAutomationEntryAction(profile, actionId);
  const contract = resolveEntryActionContract(contractRegistry, action.contractId);
  if (action.execution?.resultPolicy !== "proposal" || contract.resultPolicy !== "proposal") protocolError("ENTRY_ACTION_RESULT_POLICY_INVALID", "Proposal entry action requires proposal result policy.", 409);
  const binding = resolveAutomationEntryActionBinding(bindings, action.id);
  const bindingStatus = await resolveBindingStatus(binding, { projectRoot: projectContext.projectRoot });
  if (bindingStatus.status !== "ready") protocolError("ENTRY_ACTION_BINDING_INVALID", bindingStatus.message ?? "Automation binding is unavailable.", 400);

  const sourcePath = normalizeEntryActionPath(request.sourcePath, "sourcePath");
  const collectionPath = normalizeEntryActionPath(request.collectionPath, "collectionPath");
  const rowId = normalizeEntryActionRowId(request.rowId);
  const sourceRowIndex = normalizeEntryActionSourceRowIndex(request.sourceRowIndex);
  if (!rowId) protocolError("ENTRY_ACTION_TARGET_MISSING", "A persistent rowId is required.", 400);
  validateEntryActionTarget(action, sourcePath, collectionPath);
  const sourceIdentity = await canonicalFileIdentity(projectContext, sourcePath);
  const documentText = await readTextFile(projectContext, sourcePath);
  const parsed = parseDocument(sourcePath, documentText);
  const model = buildDocumentModel(parsed.data, parsed.format, sourcePath);
  const rowContext = resolveEntryActionRow(model, collectionPath, sourceRowIndex, rowId);
  if (typeof request.expectedRowDigest !== "string" || !request.expectedRowDigest
    || rowDigest(rowContext.row) !== request.expectedRowDigest) {
    protocolError("ENTRY_ACTION_TARGET_STALE", "The canonical target row no longer matches the requested digest.", 409);
  }
  const authoritySnapshot = createAuthoritySnapshot({
    profile,
    actionId,
    file: sourcePath,
    collection: collectionPath,
    row: rowContext.row,
    documentTarget: resolveAuthorityDocumentTarget({ action, viewConfig, sourcePath, collectionPath, row: rowContext.row }),
    contract,
  });
  const handoffArtifactState = await readArtifactState(projectContext, authoritySnapshot.textArtifact);
  const runtime = resolveAutomationExecutionConfig({ rule: action, binding, defaults: bindings.defaults }).runtime;
  const runId = dependencies.runId ?? createEntryActionRunId();
  const jobInstanceId = dependencies.jobInstanceId ?? crypto.randomUUID();
  const allocator = createAllocator({ stateRoot: fencingRoot(projectContext) });
  const lease = dependencies.lease ?? await allocator.allocate({ canonicalFileKey: sourceIdentity.canonicalFileKey, runId, jobInstanceId });
  const scratch = path.join(os.tmpdir(), `data-editor-entry-action-${runId}`);
  let handle = null;
  let evidencePersisted = false;
  let startedStateWritten = false;

  try {
    await mkdir(scratch, { recursive: false });
    await atomicWrite(path.join(scratch, "owner.json"), `${JSON.stringify({
      version: 1,
      runId,
      projectId: project.id,
      canonicalFileKey: sourceIdentity.canonicalFileKey,
    }, null, 2)}\n`);
    const handoff = buildProposalHandoff({
      runId,
      project,
      action,
      binding,
      runtime,
      sourcePath,
      collectionPath,
      rowId,
      sourceIdentity,
      documentText,
      rowContext,
      authoritySnapshot,
      handoffArtifactState,
      lease,
    });
    await writeEntryActionHandoff(projectContext, runId, handoff);
    await writeEntryActionStarted(projectContext, runId, {
      version: 2,
      runId,
      actionId,
      phase: "queued",
      outcome: null,
      startedAt: new Date().toISOString(),
    });
    startedStateWritten = true;
    const promptPath = path.join(scratch, "prompt.md");
    const replyPath = path.join(scratch, "reply.json");
    const eventsPath = path.join(scratch, "events.jsonl");
    const diagnosticsPath = path.join(scratch, "diagnostics.log");
    const skillContent = await readFile(bindingStatus.skillPath, "utf8");
    await atomicWrite(promptPath, buildEntryActionProposalPrompt({
      skillPath: bindingStatus.skillPath,
      skillContent,
      handoff,
    }));
    handle = await jobSupervisor.start({
      id: runId,
      jobInstanceId,
      command: process.execPath,
      args: [
        path.resolve(toolRoot, "scripts", "run-entry-action-proposal-host.mjs"),
        "--codex", bindingStatus.codexCliPath,
        "--scratch", scratch,
        "--prompt", promptPath,
        "--reply", replyPath,
        "--events", eventsPath,
        "--diagnostics", diagnosticsPath,
        "--model", runtime.model,
        "--reasoning", runtime.reasoning,
        "--verbosity", runtime.verbosity,
      ],
      cwd: scratch,
      timeoutMs: runtime.timeoutMs,
    });
    await allocator.persistOwnedEvidence(lease, {
      jobInstanceId: handle.jobInstanceId,
      helper: { pid: String(handle.helper.pid), creationFileTime: handle.helper.creationFileTime },
      child: { pid: String(handle.child.pid), creationFileTime: handle.child.creationFileTime },
    });
    evidencePersisted = true;
    await advanceEntryActionPhase(projectContext, runId, "running");
    const stopHeartbeat = startLeaseHeartbeat(allocator, lease);
    const completion = finishRun({
      projectContext,
      action,
      profile,
      authoritySnapshot,
      contract,
      lease,
      allocator,
      handle,
      replyPath,
      eventsPath,
      diagnosticsPath,
      scratch,
      documentCommitCoordinator,
      sourceIdentity,
      documentText,
      handoff,
      stopHeartbeat,
    });
    return { runId, completion };
  } catch (error) {
    await handle?.terminate("startup_failed").catch(() => {});
    if (!handle) {
      await allocator.abortLaunching(lease).catch(() => {});
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
      if (startedStateWritten) {
        await publishTerminal(projectContext, runId, actionId, "failed", "Entry-action host did not start.").catch(() => {});
      }
      throw error;
    }
    if (evidencePersisted) {
      await allocator.release(lease).catch(() => {});
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    await allocator.markEvidencePending(lease).catch(() => {});
    if (startedStateWritten) {
      await publishTerminal(
        projectContext,
        runId,
        actionId,
        "failed_needs_recovery",
        "Entry-action launch did not establish durable supervised ownership.",
      ).catch(() => {});
    }
    throw Object.assign(new Error("Entry-action launch did not establish durable supervised ownership.", { cause: error }), {
      code: "ENTRY_ACTION_LAUNCH_NEEDS_RECOVERY",
      status: 503,
      runId,
    });
  }
}

/** Fresh server-side admission for a proposal produced outside the proposal host. */
export async function submitFreshEntryActionProposal({
  projectContext,
  project,
  request,
  result,
  documentCommitCoordinator = createDocumentCommitCoordinator(),
  dependencies = {},
}) {
  const actionId = String(request?.actionId ?? "").trim();
  const sourcePath = normalizeEntryActionPath(request?.sourcePath, "sourcePath");
  const collectionPath = normalizeEntryActionPath(request?.collectionPath, "collectionPath");
  const rowId = normalizeEntryActionRowId(request?.rowId);
  if (!rowId) protocolError("ENTRY_ACTION_TARGET_MISSING", "A persistent rowId is required.", 400);
  const [profile, viewConfig, contractRegistry] = await Promise.all([
    loadAutomationProfile(projectContext), loadViewConfig(projectContext), loadEntryActionContracts(projectContext),
  ]);
  const action = findAutomationEntryAction(profile, actionId);
  validateEntryActionTarget(action, sourcePath, collectionPath);
  const contract = resolveEntryActionContract(contractRegistry, action.contractId);
  if (action.execution?.resultPolicy !== "proposal" || contract.resultPolicy !== "proposal") protocolError("ENTRY_ACTION_RESULT_POLICY_INVALID", "Fresh proposal admission requires proposal result policy.", 409);
  const documentText = await readTextFile(projectContext, sourcePath);
  const sourceIdentity = await canonicalFileIdentity(projectContext, sourcePath);
  const parsed = parseDocument(sourcePath, documentText);
  const model = buildDocumentModel(parsed.data, parsed.format, sourcePath);
  const rowContext = resolveEntryActionRow(model, collectionPath, null, rowId);
  if (typeof request?.expectedRowDigest !== "string" || rowDigest(rowContext.row) !== request.expectedRowDigest) protocolError("ENTRY_ACTION_TARGET_STALE", "The canonical target row no longer matches the requested digest.", 409);
  const authoritySnapshot = createAuthoritySnapshot({
    profile, actionId, file: sourcePath, collection: collectionPath, row: rowContext.row,
    documentTarget: resolveAuthorityDocumentTarget({ action, viewConfig, sourcePath, collectionPath, row: rowContext.row }), contract,
  });
  const runId = dependencies.runId ?? createEntryActionRunId();
  const jobInstanceId = dependencies.jobInstanceId ?? crypto.randomUUID();
  const allocator = (dependencies.createFencingAllocator ?? createFencingAllocator)({ stateRoot: fencingRoot(projectContext) });
  const lease = await allocator.allocate({ canonicalFileKey: sourceIdentity.canonicalFileKey, runId, jobInstanceId });
  const evidence = Array.isArray(result?.evidence) ? structuredClone(result.evidence) : [];
  const rawProposal = result?.proposal ?? result;
  const handoff = {
    runId,
    action: { id: action.id },
    entry: { sourcePath, canonicalFileKey: sourceIdentity.canonicalFileKey, collectionPath, rowId },
    proposalContract: { version: 3, baseDocumentEtag: etag(documentText), ruleDigest: authoritySnapshot.ruleDigest, fencingToken: lease.fencingToken },
  };
  const proposal = bindProposalToHandoff({ changes: rawProposal.changes, textArtifact: rawProposal.textArtifact ?? null, summary: rawProposal.summary }, handoff);
  await writeEntryActionHandoff(projectContext, runId, { ...handoff, authority: authoritySnapshot });
  await writeEntryActionStarted(projectContext, runId, { version: 2, runId, actionId, operation: "proposal", phase: "committing", outcome: null, startedAt: new Date().toISOString() });
  let keepLease = false;
  try {
    assertEntryActionResultPolicies(contract, { textArtifact: proposal.textArtifact, evidence });
    await commitProposal({ projectContext, action, authoritySnapshot, contract, evidence, lease, allocator, documentCommitCoordinator, sourceIdentity }, proposal);
    return { kind: "entry-action-proposal", runId, outcome: "completed_with_writeback" };
  } catch (error) {
    keepLease = recoveryError(error);
    throw error;
  } finally {
    if (!keepLease) await allocator.abortLaunching(lease).catch(() => {});
  }
}

export async function recoverProposalOnlyEntryActionGroup({
  projectContext,
  runId,
  recoveryLease,
  documentCommitCoordinator = createDocumentCommitCoordinator(),
}) {
  const groupJournal = createEntryActionGroupJournal({ directory: groupJournalRoot(projectContext) });
  const group = await groupJournal.readOptional(`group_${digest(runId)}`);
  if (group === null) return { recovered: false };
  if (!sameRecoveryOwnership(group.ownership, recoveryLease)) {
    protocolError("ENTRY_ACTION_RECOVERY_OWNERSHIP_CHANGED", "Recovery ownership does not match the group journal.", 503);
  }
  const proposal = JSON.parse(await readFile(entryActionProposalPath(projectContext, runId), "utf8"));
  const [sourceIdentity, artifactIdentity] = await Promise.all([
    canonicalFileIdentity(projectContext, group.source.path),
    canonicalProjectArtifactIdentity(projectContext, group.artifact.path),
  ]);
  const terminal = {
    version: 2,
    runId,
    actionId: proposal.actionId,
    phase: "terminal",
    outcome: "completed_with_writeback",
    message: proposal.summary,
  };
  await commitEntryActionGroup({
    coordinator: documentCommitCoordinator,
    groupJournal,
    childJournal: createCommitJournal({ directory: childJournalRoot(projectContext) }),
    groupEntry: group,
    sourceIdentity,
    artifactIdentity,
    readSource: () => readTextFile(projectContext, group.source.path),
    writeSource: (text) => writeTextFile(projectContext, group.source.path, text),
    readArtifact: async () => (await readArtifactState(projectContext, {
      id: group.artifact.childEntry.artifactId,
      path: group.artifact.path,
    })).text,
    writeArtifact: (text) => atomicWrite(artifactIdentity.resolvedPath, text),
    verifyOwnership: async (ownership) => {
      if (!sameRecoveryOwnership(ownership, recoveryLease)) {
        protocolError("ENTRY_ACTION_RECOVERY_OWNERSHIP_CHANGED", "Recovery ownership changed.", 503);
      }
    },
    verifyAuthority: async (expected) => {
      const [profile, viewConfig, contractRegistry, sourceText] = await Promise.all([
        loadAutomationProfile(projectContext),
        loadViewConfig(projectContext),
        loadEntryActionContracts(projectContext),
        readTextFile(projectContext, proposal.sourcePath),
      ]);
      const currentAction = findAutomationEntryAction(profile, proposal.actionId);
      const contract = resolveEntryActionContract(contractRegistry, currentAction.contractId);
      const parsed = parseDocument(proposal.sourcePath, sourceText);
      const model = buildDocumentModel(parsed.data, parsed.format, proposal.sourcePath);
      const { row } = resolveEntryActionRow(model, proposal.collectionPath, null, proposal.rowId);
      const snapshot = createAuthoritySnapshot({
        profile,
        actionId: proposal.actionId,
        file: proposal.sourcePath,
        collection: proposal.collectionPath,
        row,
        documentTarget: resolveAuthorityDocumentTarget({
          action: currentAction,
          viewConfig,
          sourcePath: proposal.sourcePath,
          collectionPath: proposal.collectionPath,
          row,
        }),
        contract,
      });
      assertAuthorityCurrent({
        snapshot: mergeGroupAuthoritySnapshot(snapshot, expected),
        profile,
        changes: proposal.changes,
        textArtifact: proposal.textArtifact,
        row,
        documentTarget: resolveAuthorityDocumentTarget({
          action: currentAction,
          viewConfig,
          sourcePath: proposal.sourcePath,
          collectionPath: proposal.collectionPath,
          row,
        }),
        contract,
      });
      assertEntryActionResultPolicies(contract, { textArtifact: { ...proposal.textArtifact, ...expected.textArtifact }, evidence: expected.evidence });
    },
    refreshIdentities: async ({ sourcePath, artifactPath }) => ({
      source: await canonicalFileIdentity(projectContext, sourcePath),
      artifact: await canonicalProjectArtifactIdentity(projectContext, artifactPath),
    }),
    publishResultIdempotently: () => publishEntryActionResultIdempotently(projectContext, runId, terminal),
  });
  return { recovered: true };
}

async function finishRun(context) {
  const { projectContext, lease, allocator, handle, runId = lease.runId } = context;
  let keepRecoveryEvidence = false;
  try {
    const completion = await handle.completion;
    if (completion.timedOut) {
      await copyDiagnostics(context.diagnosticsPath, entryActionDiagnosticsPath(projectContext, runId));
      await publishTerminal(projectContext, runId, context.action.id, "timed_out", "Codex execution timed out.");
      return;
    }
    if (completion.exitCode !== 0) {
      await copyDiagnostics(context.diagnosticsPath, entryActionDiagnosticsPath(projectContext, runId));
      await publishTerminal(projectContext, runId, context.action.id, "failed", `Codex exited with code ${completion.exitCode}.`);
      return;
    }
    const reply = await readFile(context.replyPath, "utf8");
    await atomicWrite(entryActionOutputPath(projectContext, runId), reply);
    const proposal = bindProposalToHandoff(JSON.parse(reply.trim()), context.handoff);
    await publishEntryActionProposal({
      directory: path.dirname(entryActionProposalPath(projectContext, runId)),
      runId,
      exitCode: completion.exitCode,
      proposal,
    });
    await advanceEntryActionPhase(projectContext, runId, "proposal_ready");
    await commitProposal(context, proposal);
  } catch (error) {
    const outcome = recoveryError(error) ? "failed_needs_recovery"
      : conflictError(error) ? "conflicted"
        : "failed";
    keepRecoveryEvidence = outcome === "failed_needs_recovery";
    await copyDiagnostics(context.diagnosticsPath, entryActionDiagnosticsPath(projectContext, runId));
    await publishTerminal(projectContext, runId, context.action.id, outcome, error?.message ?? String(error)).catch(() => {});
  } finally {
    await context.stopHeartbeat?.();
    if (!keepRecoveryEvidence) {
      await allocator.release(lease).catch(async (error) => {
        await publishTerminal(projectContext, runId, context.action.id, "failed_needs_recovery", error.message).catch(() => {});
      });
      await rm(context.scratch, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// Proposal identity belongs to the server-created run, not to the model response.
// Models still supply only the requested changes and summary.
export function bindProposalToHandoff(proposal, handoff) {
  const textArtifact = proposal?.textArtifact && typeof proposal.textArtifact.afterContent === "string"
    ? { ...proposal.textArtifact, afterDigest: digest(proposal.textArtifact.afterContent) }
    : proposal?.textArtifact;
  return {
    ...proposal,
    textArtifact,
    version: handoff.proposalContract.version,
    runId: handoff.runId,
    actionId: handoff.action.id,
    sourcePath: handoff.entry.sourcePath,
    canonicalFileKey: handoff.entry.canonicalFileKey,
    collectionPath: handoff.entry.collectionPath,
    rowId: handoff.entry.rowId,
    baseDocumentEtag: handoff.proposalContract.baseDocumentEtag,
    ruleDigest: handoff.proposalContract.ruleDigest,
    fencingToken: handoff.proposalContract.fencingToken,
  };
}

async function commitProposal(context, proposal) {
  const {
    projectContext,
    action,
    authoritySnapshot,
    contract,
    lease,
    allocator,
    documentCommitCoordinator,
    sourceIdentity,
    evidence = [],
  } = context;
  await advanceEntryActionPhase(projectContext, proposal.runId, "committing");
  const currentDocumentText = await readTextFile(projectContext, proposal.sourcePath);
  const artifactState = await readArtifactState(projectContext, proposal.textArtifact);
  const [currentProfile, currentViewConfig, currentContractRegistry] = await Promise.all([
    loadAutomationProfile(projectContext),
    loadViewConfig(projectContext),
    loadEntryActionContracts(projectContext),
  ]);
  const currentAction = findAutomationEntryAction(currentProfile, proposal.actionId);
  const currentContract = resolveEntryActionContract(currentContractRegistry, currentAction.contractId);
  const prepared = await prepareEntryActionProposalCommit({
    proposal,
    lease,
    authoritySnapshot,
    contract: currentContract,
    profile: currentProfile,
    documentTarget: resolveAuthorityDocumentTarget({ action: currentAction, viewConfig: currentViewConfig, sourcePath: proposal.sourcePath, collectionPath: proposal.collectionPath, row: resolveProposalRow(currentDocumentText, proposal) }),
    documentText: currentDocumentText,
    textArtifactCurrentText: artifactState.text,
    format: path.extname(proposal.sourcePath).toLowerCase() === ".csv" ? "csv" : "json",
    probeLease: (value) => allocator.probe(value),
    evidence,
  });
  const terminal = {
    version: 2,
    runId: proposal.runId,
    actionId: action.id,
    phase: "terminal",
    outcome: "completed_with_writeback",
    message: proposal.summary,
  };
  const childJournal = createCommitJournal({ directory: childJournalRoot(projectContext) });
  if (!prepared.textArtifact) {
    await documentCommitCoordinator.withCommit({ projectContext, sourcePath: proposal.sourcePath }, async () => {
      const latestText = await readTextFile(projectContext, proposal.sourcePath);
      const [latestProfile, latestViewConfig, latestContractRegistry] = await Promise.all([
        loadAutomationProfile(projectContext),
        loadViewConfig(projectContext),
        loadEntryActionContracts(projectContext),
      ]);
      const latestAction = findAutomationEntryAction(latestProfile, proposal.actionId);
      const latestContract = resolveEntryActionContract(latestContractRegistry, latestAction.contractId);
      const latestPrepared = await prepareEntryActionProposalCommit({
        proposal,
        lease,
        authoritySnapshot,
        contract: latestContract,
        profile: latestProfile,
        documentTarget: resolveAuthorityDocumentTarget({ action: latestAction, viewConfig: latestViewConfig, sourcePath: proposal.sourcePath, collectionPath: proposal.collectionPath, row: resolveProposalRow(latestText, proposal) }),
        documentText: latestText,
        format: prepared.format,
        probeLease: (value) => allocator.probe(value),
        evidence,
      });
      await commitEntryActionProposal({
        journal: childJournal,
        prepared: latestPrepared,
        lease,
        documentText: latestText,
        writeText: (text) => writeTextFile(projectContext, proposal.sourcePath, text),
        readText: () => readTextFile(projectContext, proposal.sourcePath),
        publishResult: () => publishEntryActionResultIdempotently(projectContext, proposal.runId, terminal),
      });
    });
    return;
  }

  const artifactIdentity = artifactState.identity
    ?? await canonicalProjectArtifactIdentity(projectContext, prepared.textArtifact.path);
  const groupEntry = createEntryActionGroupJournalEntry({
    prepared: { ...prepared, evidence: structuredClone(evidence) },
    lease,
    documentText: currentDocumentText,
    sourceIdentity,
    artifactIdentity,
  });
  await commitEntryActionGroup({
    coordinator: documentCommitCoordinator,
    groupJournal: createEntryActionGroupJournal({ directory: groupJournalRoot(projectContext) }),
    childJournal,
    groupEntry,
    sourceIdentity,
    artifactIdentity,
    readSource: () => readTextFile(projectContext, proposal.sourcePath),
    writeSource: (text) => writeTextFile(projectContext, proposal.sourcePath, text),
    readArtifact: async () => (await readArtifactState(projectContext, proposal.textArtifact)).text,
    writeArtifact: (text) => atomicWrite(artifactIdentity.resolvedPath, text),
    verifyOwnership: async (ownership) => {
      const current = await allocator.probe(ownership);
      if (current.status !== "owned"
        || current.lease.ownerToken !== ownership.ownerToken
        || current.lease.ownerHash !== ownership.ownerHash
        || current.lease.fencingToken !== ownership.fencingToken) {
        protocolError("ENTRY_ACTION_ADMISSION_OWNERSHIP_CHANGED", "Entry-action ownership changed.", 503);
      }
    },
    verifyAuthority: async (expected) => {
      const [profile, viewConfig, contractRegistry] = await Promise.all([
        loadAutomationProfile(projectContext),
        loadViewConfig(projectContext),
        loadEntryActionContracts(projectContext),
      ]);
      const sourceText = await readTextFile(projectContext, proposal.sourcePath);
      const parsed = parseDocument(proposal.sourcePath, sourceText);
      const model = buildDocumentModel(parsed.data, parsed.format, proposal.sourcePath);
      const { row } = resolveEntryActionRow(model, proposal.collectionPath, null, proposal.rowId);
      const currentAction = findAutomationEntryAction(profile, proposal.actionId);
      const currentContract = resolveEntryActionContract(contractRegistry, currentAction.contractId);
      assertAuthorityCurrent({
        snapshot: mergeGroupAuthoritySnapshot(authoritySnapshot, expected),
        profile,
        changes: proposal.changes,
        textArtifact: proposal.textArtifact,
        row,
        documentTarget: resolveAuthorityDocumentTarget({ action: currentAction, viewConfig, sourcePath: proposal.sourcePath, collectionPath: proposal.collectionPath, row }),
        contract: currentContract,
      });
      assertEntryActionResultPolicies(currentContract, { textArtifact: { ...proposal.textArtifact, ...expected.textArtifact }, evidence });
    },
    refreshIdentities: async ({ sourcePath, artifactPath }) => ({
      source: await canonicalFileIdentity(projectContext, sourcePath),
      artifact: await canonicalProjectArtifactIdentity(projectContext, artifactPath),
    }),
    publishResultIdempotently: () => publishEntryActionResultIdempotently(projectContext, proposal.runId, terminal),
  });
}

function resolveAuthorityDocumentTarget({ action, viewConfig, sourcePath, collectionPath, row }) {
  const target = action?.targets?.find((item) => item.file === sourcePath && item.collection === collectionPath);
  if (!target?.textArtifact) return null;
  return resolveEntryActionDocumentTarget({ viewConfig, file: sourcePath, collection: collectionPath, row });
}

function mergeGroupAuthoritySnapshot(authoritySnapshot, expected) {
  if (!authoritySnapshot || expected?.ruleDigest !== authoritySnapshot.ruleDigest) {
    protocolError("ENTRY_ACTION_PROFILE_STALE", "Entry-action authority changed before group commit.", 409);
  }
  const authoritativeArtifact = authoritySnapshot.textArtifact;
  if (!authoritativeArtifact || expected?.textArtifact?.path !== authoritativeArtifact.path) {
    protocolError("ENTRY_ACTION_PROFILE_STALE", "Entry-action text artifact authority changed before group commit.", 409);
  }
  return {
    ...authoritySnapshot,
    ruleDigest: expected.ruleDigest,
    textArtifact: { ...authoritativeArtifact },
  };
}

function resolveProposalRow(documentText, proposal) {
  const parsed = parseDocument(proposal.sourcePath, documentText);
  const model = buildDocumentModel(parsed.data, parsed.format, proposal.sourcePath);
  return resolveEntryActionRow(model, proposal.collectionPath, null, proposal.rowId).row;
}

function buildProposalHandoff({
  runId,
  project,
  action,
  binding,
  runtime,
  sourcePath,
  collectionPath,
  rowId,
  sourceIdentity,
  documentText,
  rowContext,
  authoritySnapshot,
  handoffArtifactState,
  lease,
}) {
  return {
    version: 2,
    runId,
    createdAt: new Date().toISOString(),
    action: { id: action.id, label: action.label, skill: binding.skill, runtime },
    project: { id: project.id, name: project.name },
    entry: {
      sourcePath,
      canonicalFileKey: sourceIdentity.canonicalFileKey,
      collectionPath,
      rowId,
      sourceRowIndex: rowContext.sourceRowIndex,
      rowCount: rowContext.rowCount,
      row: action.payload.includeRow ? structuredClone(rowContext.row) : null,
      previousRow: action.payload.includeNeighbors ? structuredClone(rowContext.previousRow) : null,
      nextRow: action.payload.includeNeighbors ? structuredClone(rowContext.nextRow) : null,
    },
    proposalContract: {
      version: 3,
      baseDocumentEtag: etag(documentText),
      ruleDigest: authoritySnapshot.ruleDigest,
      fencingToken: lease.fencingToken,
      writableFields: [...authoritySnapshot.writableFields],
      textArtifact: authoritySnapshot.textArtifact ? {
        ...authoritySnapshot.textArtifact,
        beforeExists: handoffArtifactState.text !== null,
        beforeDigest: handoffArtifactState.text === null ? null : digest(handoffArtifactState.text),
        currentContent: handoffArtifactState.text,
      } : null,
    },
  };
}

async function readArtifactState(projectContext, artifact) {
  if (!artifact) return { identity: null, text: undefined };
  const identity = await canonicalProjectArtifactIdentity(projectContext, artifact.path);
  try {
    return { identity, text: await readFile(identity.resolvedPath, "utf8") };
  } catch (error) {
    if (error?.code === "ENOENT") return { identity, text: null };
    throw error;
  }
}

async function publishTerminal(projectContext, runId, actionId, outcome, message) {
  return publishEntryActionResultIdempotently(projectContext, runId, {
    version: 2,
    runId,
    actionId,
    phase: "terminal",
    outcome,
    message,
  });
}

function startLeaseHeartbeat(allocator, lease, intervalMs = 5_000) {
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending.then(() => allocator.heartbeat(lease)).catch(() => {});
  }, intervalMs);
  timer.unref?.();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}

async function copyDiagnostics(source, target) {
  try { await atomicWrite(target, await readFile(source, "utf8")); } catch {}
}
function parseDocument(sourcePath, text) {
  return path.extname(sourcePath).toLowerCase() === ".csv"
    ? { data: parseCsv(text), format: "csv" }
    : parseJson(text);
}
function fencingRoot(context) { return resolveInsideRoot(context.projectRoot, path.join(context.runtimeDir, "entry-action-fencing")); }
function childJournalRoot(context) { return resolveInsideRoot(context.projectRoot, path.join(context.runtimeDir, "entry-action-commit-journal")); }
function groupJournalRoot(context) { return resolveInsideRoot(context.projectRoot, path.join(context.runtimeDir, "entry-action-group-journal")); }
function etag(text) { return `"${crypto.createHash("sha256").update(text, "utf8").digest("hex")}"`; }
function digest(text) { return crypto.createHash("sha256").update(text, "utf8").digest("hex"); }
function sameRecoveryOwnership(left, right) {
  return left && right
    && left.canonicalFileKey === right.canonicalFileKey
    && left.ownerToken === right.ownerToken
    && left.ownerHash === right.ownerHash
    && left.fencingToken === right.fencingToken
    && left.jobInstanceId === right.jobInstanceId;
}
function recoveryError(error) { return String(error?.code ?? "").includes("RECOVERY") || String(error?.code ?? "").includes("OWNERSHIP"); }
function conflictError(error) { return String(error?.code ?? "").includes("STALE") || String(error?.code ?? "").includes("CONFLICT") || String(error?.code ?? "").includes("MISMATCH"); }
function protocolError(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }
