import {assertHistoricalRunAllowed} from './historical-disposition.mjs';
import { publicationStart, publicationSubmit, publicationRecovery, publicationExistingOperation, publicationConfigWrite, publicationObserve, publicationIsOpen } from './publication-window-runtime.mjs';
import path from "node:path";
import { readFile } from "node:fs/promises";
import { serviceProcessIsAlive } from "./service-process-identity.mjs";
import { commandDigest, commandError, restoreProjectCommandSnapshot, projectCommandCommitIdentities, assertProjectCommandDependencies } from "./project-command-snapshot.mjs";
import { entryActionHandoffPath, entryActionProposalPath, readEntryActionResult, publishEntryActionResultIdempotently, findAutomationEntryAction } from "./entry-actions.mjs";
import { findFencingLeaseByRunId, readCurrentFencingAdmission } from "./fencing-lock.mjs";
import { claimFencingAdmission, verifyRecoveryClaim, releaseClaimedAdmission, writeCompletedRecoveryRecord, finalizeClaimedRecovery, readCompletedRecoveryRecord, findExistingRecoveryClaim } from "./entry-action-recovery.mjs";
import { createDocumentCommitCoordinator } from "./document-commit-coordinator.mjs";
import { loadAutomationProfile } from "./automation-profile.mjs";
import { loadEntryActionContracts, resolveEntryActionContract } from "./entry-action-contracts.mjs";
import { createCommitJournal } from "./commit-journal.mjs";
import { classifyCommitJournalRecovery } from "./commit-journal-recovery.mjs";
import { prepareEntryActionProposalCommit } from "./entry-action-proposal-commit.mjs";
import { proposalResultStatusDetails } from "./entry-action-result-status.mjs";
import { serializeJson } from "./json-codec.mjs";
import { serializeCsv } from "./csv-codec.mjs";
import { readTextFile } from "./file-service.mjs";
import { withProjectProcessLock } from "./project-process-lock.mjs";

import { validateProjectCommandResult } from "./project-command-validator.mjs";

const pending = new Map();
const optional = async operation => { try { return await operation(); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };

// All observers of a run share one recovery operation; the durable fencing
// claim and document coordinator also protect against another service process.
async function recoverProjectCommandRunImplementation(context, runId, coordinator = createDocumentCommitCoordinator()) {
  const key = entryActionHandoffPath(context, runId);
  if (pending.has(key)) return pending.get(key);
  const handoff = await optional(async () => JSON.parse(await readFile(key, "utf8")));
  if (handoff?.action?.execution?.kind !== "project-command") return { recovered: false };
  const alive = await serviceProcessIsAlive(handoff.projectCommand?.writer);
  if (alive !== false) {
    if (alive === null && !await optional(() => readEntryActionResult(context, runId))) throw commandError("PROJECT_COMMAND_RECOVERY_REQUIRED", "无法核实原生成服务身份，已保留原内容与任务，请先核查服务状态。");
    return { recovered: false, reason: alive ? "writer_active" : "writer_unverifiable" };
  }
  const operation = withProjectProcessLock(`entry-action-recovery:${key}`, () => recover(context, runId, coordinator));
  pending.set(key, operation);
  try { return await operation; } finally { pending.delete(key); }
}
async function recover(context, runId, coordinator) {
  const handoff = await optional(async () => JSON.parse(await readFile(entryActionHandoffPath(context, runId), "utf8")));
  if (handoff?.action?.execution?.kind !== "project-command") return { recovered: false };
  const terminal = await optional(() => readEntryActionResult(context, runId));
  const alive = await serviceProcessIsAlive(handoff.projectCommand?.writer);
  if (alive === null && !terminal) throw commandError("PROJECT_COMMAND_RECOVERY_REQUIRED", "无法核实原生成服务身份，已保留原内容与任务，请先核查服务状态。");
  if (alive !== false) return { recovered: false, reason: alive ? "writer_active" : "writer_unverifiable" };
  const stateRoot = path.join(context.projectRoot, context.runtimeDir, "entry-action-fencing");
  const lease = await findFencingLeaseByRunId(stateRoot, runId);
  if (!lease) {
    if (!terminal) {await assertHistoricalRunAllowed(context,[runId],{fullInventory:true});await interrupted(context, handoff);}
    return { recovered: true };
  }
  if (await readCompletedRecoveryRecord({ stateRoot, lease })) {
    const completedClaim = await findExistingRecoveryClaim(stateRoot, lease);
    if (completedClaim) { await assertHistoricalRunAllowed(context,[runId],{fullInventory:true});await releaseClaimedAdmission(completedClaim); await finalizeClaimedRecovery(completedClaim); }
    return { recovered: true };
  }
  const currentLease = await readCurrentFencingAdmission(stateRoot, lease.canonicalFileKey);
  const existingClaim = await findExistingRecoveryClaim(stateRoot, lease);
  if (terminal && !existingClaim && (!currentLease || currentLease.runId !== runId)) return { recovered: false, reason: "already_terminal" };
  await assertHistoricalRunAllowed(context,[runId],{fullInventory:true});
  const claim = await claimFencingAdmission({ stateRoot, lease });
  const release = async () => {
    await releaseClaimedAdmission(claim);
    try { await writeCompletedRecoveryRecord({ stateRoot, ...lease }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    await finalizeClaimedRecovery(claim);
  };
  if (terminal) { await release(); return { recovered: true }; }
  // A failed/ambiguous verifier deliberately retains the claim for a later
  // recovery. It never guesses that an in-flight write did not happen.
  try {
    const proposal = await optional(async () => JSON.parse(await readFile(entryActionProposalPath(context, runId), "utf8")));
    if (!proposal) { await interrupted(context, handoff); await release(); return { recovered: true }; }
    const journal = createCommitJournal({ directory: path.join(context.projectRoot, context.runtimeDir, "entry-action-commit-journal") });
    const id = `proposal_${commandDigest(`${runId}:${commandDigest(JSON.stringify(proposal))}`)}`;
    let entry;
    try { entry = await journal.read(id); } catch (error) { if (error.code !== "COMMIT_JOURNAL_MISSING") throw error; }
    if (!entry) {
      if (proposal.textArtifact) throw commandError("PROJECT_COMMAND_RECOVERY_REQUIRED");
      await interrupted(context, handoff); await release(); return { recovered: true };
    }
    if (entry.runId !== runId || entry.ownerToken !== lease.ownerToken || entry.fencingToken !== lease.fencingToken || entry.canonicalFileKey !== handoff.entry.canonicalFileKey) throw commandError("PROJECT_COMMAND_RECOVERY_OWNERSHIP_CHANGED");
    const profile = await loadAutomationProfile(context);
    const action = findAutomationEntryAction(profile, handoff.action.id);
    const baseline = await restoreProjectCommandSnapshot(context, handoff.projectCommand.baseline, action);
    if (action.execution.proposalValidator && (proposal.textArtifact || handoff.projectCommand.requestBinding?.requestContextDigest !== baseline.requestContextDigest || handoff.projectCommand.requestBinding?.proposalDigest !== commandDigest(JSON.stringify(proposal)))) throw commandError("PROJECT_COMMAND_RECOVERY_REQUEST_BINDING_INVALID");
    await coordinator.withIdentities(await projectCommandCommitIdentities(context, baseline), async () => {
      await verifyRecoveryClaim({ stateRoot, lease, ...claim });
      await assertProjectCommandDependencies(context, baseline);
      const current = await readTextFile(context, handoff.entry.sourcePath);
      const disposition = classifyCommitJournalRecovery({ entry, currentEtag: `"${commandDigest(current)}"`, currentDigest: commandDigest(current), proposalAfterMatches: true });
      if (disposition.disposition === "uncommitted") { await interrupted(context, handoff); return; }
      if (disposition.disposition === "failed_needs_recovery") throw commandError("PROJECT_COMMAND_RECOVERY_SOURCE_CHANGED");
      const contract = resolveEntryActionContract(await loadEntryActionContracts(context), action.contractId);
      const format = path.extname(proposal.sourcePath).toLowerCase() === ".csv" ? "csv" : "json";
      const prepared = await prepareEntryActionProposalCommit({ proposal, lease, authoritySnapshot: handoff.authority, contract, profile,
        documentText: baseline.documentText, format, evidence: proposal.evidence,
        // The claimed lease is proven above; the old allocator is intentionally
        // fenced out while recovery verifies the original authorized proposal.
        probeLease: async () => { await verifyRecoveryClaim({ stateRoot, lease, ...claim }); return { status: "owned", lease }; },
      });
      const expected = format === "csv" ? serializeCsv(prepared.root) : serializeJson(prepared.root);
      if (commandDigest(expected) !== entry.afterDigest || commandDigest(current) !== entry.afterDigest) throw commandError("PROJECT_COMMAND_RECOVERY_AFTER_MISMATCH");
      await validateProjectCommandResult({ context, action, baseline, runId, mode: "recovery", proposal, changes: proposal.changes, afterRoot: prepared.root });
      await assertProjectCommandDependencies(context, baseline);
      if (commandDigest(await readTextFile(context, handoff.entry.sourcePath)) !== entry.afterDigest) throw commandError("PROJECT_COMMAND_RECOVERY_AFTER_MISMATCH");
      if (entry.stage === "commit_intent") entry = await journal.advance(entry, "source_replaced");
      if (entry.stage === "source_replaced") entry = await journal.advance(entry, "verified");
      await publishEntryActionResultIdempotently(context, runId, { version: 2, runId, actionId: proposal.actionId, phase: "terminal", outcome: "completed_with_writeback", message: proposal.summary, ...proposalResultStatusDetails(proposal) });
      if (entry.stage === "verified") await journal.advance(entry, "result_published");
    });
    await release();
    return { recovered: true };
  } catch (cause) {
    throw commandError("PROJECT_COMMAND_RECOVERY_REQUIRED", `正式描述提交状态需要恢复核查，未重复生成或覆盖内容。${cause.code ?? cause.message}`);
  }
}
async function interrupted(context, handoff) {
  await publishEntryActionResultIdempotently(context, handoff.runId, { version: 2, runId: handoff.runId, actionId: handoff.action.id, phase: "terminal", outcome: "failed", message: "生成服务已中断，编辑内容已保留，请重新生成正式描述。" });
}

export const recoverProjectCommandRun = async (context, runId, coordinator, options = {}) => options.observer ? publicationObserve(context,runId,() => recoverProjectCommandRunImplementation(context,runId,coordinator)) : publicationRecovery(input => recoverProjectCommandRunImplementation(context,runId,input.documentCommitCoordinator))({projectContext:context,runId,documentCommitCoordinator:coordinator});
