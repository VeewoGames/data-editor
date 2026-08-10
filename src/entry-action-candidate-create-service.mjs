import path from "node:path";
import { readFile } from "node:fs/promises";
import { atomicWrite } from "./atomic-file.mjs";
import { canonicalFileIdentity } from "./canonical-file-identity.mjs";
import { canonicalProjectArtifactIdentity } from "./canonical-project-artifact-identity.mjs";
import { createCommitJournal } from "./commit-journal.mjs";
import { createDocumentCommitCoordinator } from "./document-commit-coordinator.mjs";
import { commitEntryActionGroup, createCandidateCreateGroupJournalEntry } from "./entry-action-group-commit.mjs";
import { createEntryActionGroupJournal } from "./entry-action-group-journal.mjs";
import { readTextFile, writeTextFile } from "./file-service.mjs";
import { resolveInsideRoot } from "./project-context.mjs";
import crypto from "node:crypto";
import { loadAutomationProfile, ruleAuthorityDigest } from "./automation-profile.mjs";
import { assertEntryActionResultPolicies, loadEntryActionContracts, resolveEntryActionContract } from "./entry-action-contracts.mjs";
import { candidateCreateRequestIdentity, prepareCandidateCreate } from "./entry-action-candidate-create.mjs";
import { findAutomationEntryAction, publishEntryActionResultIdempotently, validateEntryActionTarget, writeEntryActionStarted } from "./entry-actions.mjs";
import { createFencingAllocator } from "./fencing-lock.mjs";

export async function commitPreparedCandidateCreate({
  projectContext,
  prepared,
  lease,
  sourceIdentity,
  artifactIdentity,
  documentText,
  documentCommitCoordinator = createDocumentCommitCoordinator(),
  verifyOwnership,
  verifyAuthority,
  publishResultIdempotently,
}) {
  assertCallbacks({ verifyOwnership, verifyAuthority, publishResultIdempotently });
  const groupJournal = createEntryActionGroupJournal({ directory: groupJournalRoot(projectContext) });
  const existing = await groupJournal.readOptional(prepared.idempotencyKey);
  if (existing) {
    const evidenceDigest = crypto.createHash("sha256").update(JSON.stringify(prepared.evidence ?? []), "utf8").digest("hex");
    if (existing.operation !== "candidate_create" || existing.candidateId !== prepared.candidateId || existing.semanticDigest !== prepared.semanticDigest || existing.evidenceDigest !== evidenceDigest) fail("CANDIDATE_CREATE_IDEMPOTENCY_CONFLICT");
    if (existing.stage !== "result_published") fail("CANDIDATE_CREATE_FAILED_NEEDS_RECOVERY");
    return { replayed: true, runId: existing.runId, candidateId: existing.candidateId, rowId: existing.rowId };
  }
  const groupEntry = createCandidateCreateGroupJournalEntry({ prepared, lease, documentText, sourceIdentity, artifactIdentity });
  const group = await commitEntryActionGroup({
    coordinator: documentCommitCoordinator,
    groupJournal,
    childJournal: createCommitJournal({ directory: childJournalRoot(projectContext) }),
    groupEntry,
    sourceIdentity,
    artifactIdentity,
    readSource: () => readTextFile(projectContext, groupEntry.source.path),
    writeSource: (text) => writeTextFile(projectContext, groupEntry.source.path, text),
    readArtifact: () => readOptionalFile(artifactIdentity.resolvedPath),
    writeArtifact: (text) => atomicWrite(artifactIdentity.resolvedPath, text),
    verifyOwnership,
    verifyAuthority,
    refreshIdentities: ({ sourcePath, artifactPath }) => refreshIdentities(projectContext, sourcePath, artifactPath),
    publishResultIdempotently,
  });
  return { replayed: false, runId: group.runId, candidateId: group.candidateId, rowId: group.rowId };
}

export async function recoverCandidateCreate({
  projectContext,
  idempotencyKey = null,
  runId = null,
  recoveryLease,
  documentCommitCoordinator = createDocumentCommitCoordinator(),
  verifyAuthority,
  publishResultIdempotently,
}) {
  assertCallbacks({ verifyOwnership: () => {}, verifyAuthority, publishResultIdempotently });
  const groupJournal = createEntryActionGroupJournal({ directory: groupJournalRoot(projectContext) });
  const group = idempotencyKey ? await groupJournal.readOptional(idempotencyKey) : await groupJournal.findByRunId(runId);
  if (!group) return { recovered: false };
  if (group.operation !== "candidate_create" || !sameOwnership(group.ownership, recoveryLease)) fail("CANDIDATE_CREATE_RECOVERY_OWNERSHIP_CHANGED");
  const identities = await refreshIdentities(projectContext, group.source.path, group.artifact.path);
  await commitEntryActionGroup({
    coordinator: documentCommitCoordinator,
    groupJournal,
    childJournal: createCommitJournal({ directory: childJournalRoot(projectContext) }),
    groupEntry: group,
    sourceIdentity: identities.source,
    artifactIdentity: identities.artifact,
    readSource: () => readTextFile(projectContext, group.source.path),
    writeSource: (text) => writeTextFile(projectContext, group.source.path, text),
    readArtifact: () => readOptionalFile(identities.artifact.resolvedPath),
    writeArtifact: (text) => atomicWrite(identities.artifact.resolvedPath, text),
    verifyOwnership: async (ownership) => { if (!sameOwnership(ownership, recoveryLease)) fail("CANDIDATE_CREATE_RECOVERY_OWNERSHIP_CHANGED"); },
    verifyAuthority,
    refreshIdentities: ({ sourcePath, artifactPath }) => refreshIdentities(projectContext, sourcePath, artifactPath),
    publishResultIdempotently,
  });
  return { recovered: true, runId: group.runId, candidateId: group.candidateId, rowId: group.rowId };
}

/** Production admission for a project-skill candidate manifest. */
export async function submitFreshCandidateCreate({
  projectContext,
  project,
  request,
  manifest,
  evidence = [],
  humanNotes = null,
  documentCommitCoordinator = createDocumentCommitCoordinator(),
  dependencies = {},
}) {
  const sourcePath = String(request?.sourcePath ?? "").trim().replaceAll("\\", "/");
  const collectionPath = String(request?.collectionPath ?? "").trim().replaceAll("\\", "/");
  const actionId = String(request?.actionId ?? "").trim();
  const [profile, registry] = await Promise.all([loadAutomationProfile(projectContext), loadEntryActionContracts(projectContext)]);
  const action = findAutomationEntryAction(profile, actionId);
  validateEntryActionTarget(action, sourcePath, collectionPath);
  const actionContract = resolveEntryActionContract(registry, action.contractId);
  if (action.execution?.resultPolicy !== "proposal" || action.createAuthority?.enabled !== true || !actionContract.createAuthority) fail("CANDIDATE_CREATE_AUTHORITY_UNAVAILABLE");
  const createContract = actionContract.createAuthority;
  if (createContract.contractId !== action.createAuthority.contractId || createContract.contractId !== action.contractId) fail("CANDIDATE_CREATE_AUTHORITY_STALE");
  assertCandidateIdentity(manifest, createContract.candidateIdPolicy);
  const sourceIdentity = await canonicalFileIdentity(projectContext, sourcePath);
  const runId = dependencies.runId ?? crypto.randomUUID();
  const jobInstanceId = dependencies.jobInstanceId ?? crypto.randomUUID();
  const allocator = (dependencies.createFencingAllocator ?? createFencingAllocator)({ stateRoot: resolveInsideRoot(projectContext.projectRoot, path.join(projectContext.runtimeDir, "entry-action-fencing")) });
  const lease = await allocator.allocate({ canonicalFileKey: sourceIdentity.canonicalFileKey, runId, jobInstanceId });
  let keepLease = false;
  try {
    const requestIdentity = candidateCreateRequestIdentity({ manifest, projectId: project.id, actionId, sourcePath, collectionPath, humanNotes, createContractDigest: createContract.digest });
    const existing = await createEntryActionGroupJournal({ directory: groupJournalRoot(projectContext) }).readOptional(requestIdentity.idempotencyKey);
    if (existing) {
      const evidenceDigest = crypto.createHash("sha256").update(JSON.stringify(evidence), "utf8").digest("hex");
      if (existing.operation !== "candidate_create" || existing.candidateId !== requestIdentity.candidateId || existing.semanticDigest !== requestIdentity.semanticDigest || existing.evidenceDigest !== evidenceDigest) fail("CANDIDATE_CREATE_IDEMPOTENCY_CONFLICT");
      if (existing.stage !== "result_published") { keepLease = true; fail("CANDIDATE_CREATE_FAILED_NEEDS_RECOVERY"); }
      assertEntryActionResultPolicies(actionContract, { textArtifact: { path: existing.artifact.path, beforeExists: existing.artifact.beforeExists, afterContent: existing.artifact.afterContent }, evidence });
      await writeEntryActionStarted(projectContext, runId, { version: 2, runId, actionId, operation: "candidate_create", idempotencyKey: existing.idempotencyKey, candidateId: existing.candidateId, phase: "committing", outcome: null, startedAt: new Date().toISOString() });
      await publishEntryActionResultIdempotently(projectContext, runId, { version: 2, runId, actionId, phase: "terminal", outcome: "completed_with_writeback", message: manifest.summary, operation: "candidate_create", candidateId: existing.candidateId, idempotencyKey: existing.idempotencyKey, rowId: existing.rowId, replayedFromRunId: existing.runId });
      return { kind: "candidate-create", runId, originalRunId: existing.runId, candidateId: existing.candidateId, rowId: existing.rowId, idempotencyKey: existing.idempotencyKey, replayed: true };
    }
    const documentText = await readTextFile(projectContext, sourcePath);
    const binding = {
      projectId: project.id, runId, actionId, sourcePath, collectionPath, canonicalFileKey: sourceIdentity.canonicalFileKey,
      baseDocumentEtag: etag(documentText), ruleDigest: ruleAuthorityDigest(action),
      fencingToken: lease.fencingToken, createContractId: createContract.contractId, createContractDigest: createContract.digest,
    };
    const prepare = (text, currentContract = createContract, persistentEntryId = null) => prepareCandidateCreate({
      manifest, binding: { ...binding, baseDocumentEtag: etag(text), createContractDigest: currentContract.digest }, createContract: currentContract, documentText: text, humanNotes,
      persistentEntryId,
      allocateServerFields: dependencies.allocateServerFields ?? null,
      resolveTextArtifact: ({ derivedTextArtifactPath }) => resolveCreateArtifact(projectContext, manifest, derivedTextArtifactPath),
    });
    const prepared = await prepare(documentText);
    assertEntryActionResultPolicies(actionContract, { textArtifact: prepared.textArtifact, evidence });
    const artifactIdentity = await canonicalProjectArtifactIdentity(projectContext, prepared.textArtifact.path);
    await writeEntryActionStarted(projectContext, runId, { version: 2, runId, actionId, operation: "candidate_create", idempotencyKey: prepared.idempotencyKey, candidateId: prepared.candidateId, phase: "committing", outcome: null, startedAt: new Date().toISOString() });
    const result = await commitPreparedCandidateCreate({
      projectContext, prepared: { ...prepared, evidence: structuredClone(evidence) }, lease, sourceIdentity, artifactIdentity, documentText, documentCommitCoordinator,
      verifyOwnership: async (ownership) => {
        const current = await allocator.probe(ownership);
        if (current.status !== "owned" || !sameOwnership(current.lease, ownership)) fail("CANDIDATE_CREATE_OWNERSHIP_CHANGED");
      },
      verifyAuthority: async (expected) => {
        const [currentProfile, currentRegistry, currentText] = await Promise.all([loadAutomationProfile(projectContext), loadEntryActionContracts(projectContext), readTextFile(projectContext, sourcePath)]);
        const currentAction = findAutomationEntryAction(currentProfile, actionId);
        const currentActionContract = resolveEntryActionContract(currentRegistry, currentAction.contractId);
        if (ruleAuthorityDigest(currentAction) !== ruleAuthorityDigest(action) || currentActionContract.digest !== actionContract.digest || currentActionContract.createAuthority?.digest !== expected.createContractDigest) fail("CANDIDATE_CREATE_AUTHORITY_STALE");
        const currentPrepared = await prepare(currentText, currentActionContract.createAuthority, prepared.rowId);
        if (currentPrepared.semanticDigest !== prepared.semanticDigest || currentPrepared.sourceAfterContent !== prepared.sourceAfterContent || currentPrepared.rowId !== prepared.rowId || currentPrepared.textArtifact?.afterDigest !== prepared.textArtifact?.afterDigest) fail("CANDIDATE_CREATE_AUTHORITY_STALE");
        assertEntryActionResultPolicies(currentActionContract, { textArtifact: currentPrepared.textArtifact, evidence });
      },
      publishResultIdempotently: () => publishEntryActionResultIdempotently(projectContext, runId, { version: 2, runId, actionId, phase: "terminal", outcome: "completed_with_writeback", message: manifest.summary, operation: "candidate_create", candidateId: prepared.candidateId, idempotencyKey: prepared.idempotencyKey, rowId: prepared.rowId }),
    });
    return { kind: "candidate-create", runId, candidateId: prepared.candidateId, rowId: prepared.rowId, idempotencyKey: prepared.idempotencyKey, replayed: result.replayed };
  } catch (error) {
    keepLease = String(error?.code ?? "").includes("RECOVERY");
    throw error;
  } finally {
    if (!keepLease) await allocator.abortLaunching(lease).catch(() => {});
  }
}

async function refreshIdentities(projectContext, sourcePath, artifactPath) {
  return { source: await canonicalFileIdentity(projectContext, sourcePath), artifact: await canonicalProjectArtifactIdentity(projectContext, artifactPath) };
}
async function readOptionalFile(file) {
  try { return await readFile(file, "utf8"); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}
function groupJournalRoot(context) { return resolveInsideRoot(context.projectRoot, path.join(context.runtimeDir, "entry-action-group-journal")); }
function childJournalRoot(context) { return resolveInsideRoot(context.projectRoot, path.join(context.runtimeDir, "entry-action-commit-journal")); }
function sameOwnership(left, right) { return left && right && left.canonicalFileKey === right.canonicalFileKey && left.ownerToken === right.ownerToken && left.ownerHash === right.ownerHash && left.fencingToken === right.fencingToken && left.jobInstanceId === right.jobInstanceId; }
function assertCallbacks(value) { for (const key of ["verifyOwnership", "verifyAuthority", "publishResultIdempotently"]) if (typeof value[key] !== "function") fail("CANDIDATE_CREATE_SERVICE_INPUT_INVALID"); }
function fail(code) { throw Object.assign(new Error(code), { code }); }
function etag(text) { return `"${crypto.createHash("sha256").update(text, "utf8").digest("hex")}"`; }
function assertCandidateIdentity(manifest, policy) {
  const candidateId = String(manifest?.candidateId ?? "");
  if (!new RegExp(policy.pattern, "u").test(candidateId) || manifest?.row?.[policy.field] !== candidateId) fail("CANDIDATE_CREATE_CANDIDATE_ID_INVALID");
}
async function resolveCreateArtifact(projectContext, manifest, artifactPath) {
  if (manifest.textArtifact === null) return null;
  const identity = await canonicalProjectArtifactIdentity(projectContext, artifactPath);
  const current = await readOptionalFile(identity.resolvedPath);
  if (current !== null && crypto.createHash("sha256").update(current, "utf8").digest("hex") !== manifest.textArtifact.afterDigest) fail("CANDIDATE_CREATE_TEXT_ARTIFACT_EXISTS");
  return { id: `candidate_${manifest.candidateId}`, path: artifactPath, beforeExists: false, beforeDigest: null, beforeContent: null, afterContent: manifest.textArtifact.afterContent, afterDigest: manifest.textArtifact.afterDigest };
}
