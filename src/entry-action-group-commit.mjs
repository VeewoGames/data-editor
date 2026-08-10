import crypto from "node:crypto";
import { serializeCsv } from "./csv-codec.mjs";
import { serializeJson } from "./json-codec.mjs";
import { createProposalCommitJournalEntry } from "./entry-action-proposal-commit.mjs";

export function createEntryActionGroupJournalEntry({ prepared, lease, documentText, sourceIdentity, artifactIdentity }) {
  if (!prepared?.textArtifact) fail("ENTRY_ACTION_GROUP_ARTIFACT_REQUIRED");
  if (sourceIdentity?.canonicalFileKey !== prepared.proposal.canonicalFileKey
    || !artifactIdentity?.canonicalFileKey
    || sourceIdentity.canonicalFileKey === artifactIdentity.canonicalFileKey) {
    fail("ENTRY_ACTION_GROUP_IDENTITY_INVALID");
  }
  assertLease(lease, sourceIdentity.canonicalFileKey, prepared.proposal.runId);
  const sourceAfterContent = serializePrepared(prepared);
  const sourceChild = createProposalCommitJournalEntry({
    proposal: prepared.proposal,
    lease,
    documentText,
    afterText: sourceAfterContent,
  });
  const artifact = prepared.textArtifact;
  const proposalDigest = digest(JSON.stringify(prepared.proposal));
  const artifactChild = {
    idempotencyKey: `artifact_${digest(`${prepared.proposal.runId}:${artifact.id}:${artifact.afterDigest}`)}`,
    saveType: "text_artifact_commit",
    canonicalFileKey: artifactIdentity.canonicalFileKey,
    baseEtag: artifact.beforeExists ? etag(artifact.beforeContent) : '"missing"',
    newEtag: etag(artifact.afterContent),
    beforeDigest: artifact.beforeExists ? artifact.beforeDigest : digest(""),
    afterDigest: artifact.afterDigest,
    requestDigest: proposalDigest,
    runId: prepared.proposal.runId,
    artifactId: artifact.id,
    artifactPath: artifact.path,
  };
  return {
    operation: "proposal",
    idempotencyKey: `group_${digest(prepared.proposal.runId)}`,
    runId: prepared.proposal.runId,
    proposalDigest,
    ruleDigest: prepared.proposal.ruleDigest,
    evidence: structuredClone(prepared.evidence ?? []),
    evidenceDigest: digest(JSON.stringify(prepared.evidence ?? [])),
    ownership: {
      canonicalFileKey: lease.canonicalFileKey,
      ownerToken: lease.ownerToken,
      ownerHash: lease.ownerHash,
      fencingToken: lease.fencingToken,
      jobInstanceId: lease.jobInstanceId,
    },
    source: {
      path: prepared.proposal.sourcePath,
      canonicalFileKey: sourceIdentity.canonicalFileKey,
      childEntry: sourceChild,
      beforeExists: true,
      beforeDigest: digest(documentText),
      afterExists: true,
      afterDigest: digest(sourceAfterContent),
      afterContent: sourceAfterContent,
    },
    artifact: {
      path: artifact.path,
      canonicalFileKey: artifactIdentity.canonicalFileKey,
      childEntry: artifactChild,
      beforeExists: artifact.beforeExists,
      beforeDigest: artifact.beforeDigest,
      beforeContent: artifact.beforeContent,
      afterExists: true,
      afterDigest: artifact.afterDigest,
      afterContent: artifact.afterContent,
    },
    stage: "group_intent",
  };
}

export function createCandidateCreateGroupJournalEntry({ prepared, lease, documentText, sourceIdentity, artifactIdentity }) {
  if (prepared?.operation !== "candidate_create" || !prepared.textArtifact) fail("ENTRY_ACTION_GROUP_ARTIFACT_REQUIRED");
  if (sourceIdentity?.canonicalFileKey !== prepared.binding.canonicalFileKey || !artifactIdentity?.canonicalFileKey
    || sourceIdentity.canonicalFileKey === artifactIdentity.canonicalFileKey) fail("ENTRY_ACTION_GROUP_IDENTITY_INVALID");
  assertLease(lease, sourceIdentity.canonicalFileKey, prepared.binding.runId);
  const proposalDigest = digest(JSON.stringify({ manifest: prepared.manifest, binding: prepared.binding, semanticDigest: prepared.semanticDigest }));
  const sourceChild = {
    idempotencyKey: `candidate_${digest(`${prepared.idempotencyKey}:${prepared.rowId}:${prepared.semanticDigest}`)}`,
    saveType: "candidate_create_commit",
    canonicalFileKey: sourceIdentity.canonicalFileKey,
    baseEtag: prepared.binding.baseDocumentEtag,
    newEtag: etag(prepared.sourceAfterContent),
    beforeDigest: digest(documentText),
    afterDigest: digest(prepared.sourceAfterContent),
    requestDigest: proposalDigest,
    runId: prepared.binding.runId,
    ownerToken: lease.ownerToken,
    fencingToken: lease.fencingToken,
    rowId: prepared.rowId,
    proposalDigest,
    changes: [],
  };
  const artifact = prepared.textArtifact;
  const artifactChild = {
    idempotencyKey: `artifact_${digest(`${prepared.idempotencyKey}:${artifact.id}:${artifact.afterDigest}`)}`,
    saveType: "text_artifact_commit",
    canonicalFileKey: artifactIdentity.canonicalFileKey,
    baseEtag: '"missing"',
    newEtag: etag(artifact.afterContent),
    beforeDigest: digest(""),
    afterDigest: artifact.afterDigest,
    requestDigest: proposalDigest,
    runId: prepared.binding.runId,
    artifactId: artifact.id,
    artifactPath: artifact.path,
  };
  return {
    operation: "candidate_create",
    idempotencyKey: prepared.idempotencyKey,
    runId: prepared.binding.runId,
    proposalDigest,
    ruleDigest: prepared.binding.ruleDigest,
    createContractDigest: prepared.createContractDigest,
    candidateId: prepared.candidateId,
    rowId: prepared.rowId,
    semanticDigest: prepared.semanticDigest,
    evidence: structuredClone(prepared.evidence ?? []),
    evidenceDigest: digest(JSON.stringify(prepared.evidence ?? [])),
    manifest: structuredClone(prepared.manifest),
    ownership: { canonicalFileKey: lease.canonicalFileKey, ownerToken: lease.ownerToken, ownerHash: lease.ownerHash, fencingToken: lease.fencingToken, jobInstanceId: lease.jobInstanceId },
    source: { path: prepared.binding.sourcePath, canonicalFileKey: sourceIdentity.canonicalFileKey, childEntry: sourceChild, beforeExists: true, beforeDigest: digest(documentText), afterExists: true, afterDigest: digest(prepared.sourceAfterContent), afterContent: prepared.sourceAfterContent },
    artifact: { path: artifact.path, canonicalFileKey: artifactIdentity.canonicalFileKey, childEntry: artifactChild, beforeExists: false, beforeDigest: null, beforeContent: null, afterExists: true, afterDigest: artifact.afterDigest, afterContent: artifact.afterContent },
    stage: "group_intent",
  };
}

/**
 * Commits a durable compound proposal.
 *
 * Callers must make verifyOwnership attest either the live lease or an exact
 * recovery claim, refreshIdentities run inside the shared formal-writer claim,
 * and publishResultIdempotently persist by the supplied idempotency key.
 */
export async function commitEntryActionGroup({
  coordinator,
  groupJournal,
  childJournal,
  groupEntry,
  sourceIdentity,
  artifactIdentity,
  readSource,
  writeSource,
  readArtifact,
  writeArtifact,
  verifyOwnership,
  verifyAuthority,
  refreshIdentities,
  publishResultIdempotently,
}) {
  assertRuntimeInputs({
    coordinator,
    groupJournal,
    childJournal,
    groupEntry,
    sourceIdentity,
    artifactIdentity,
    verifyOwnership,
    verifyAuthority,
    refreshIdentities,
    publishResultIdempotently,
    readSource,
    writeSource,
    readArtifact,
    writeArtifact,
  });
  return coordinator.withIdentities([sourceIdentity, artifactIdentity], async () => {
    const existing = await groupJournal.readOptional(groupEntry.idempotencyKey);
    let group;
    if (existing === null) {
      await verifyOwnership(groupEntry.ownership);
      await verifyAuthority({
        ruleDigest: groupEntry.ruleDigest,
        operation: groupEntry.operation ?? "proposal",
        createContractDigest: groupEntry.createContractDigest ?? null,
        candidateId: groupEntry.candidateId ?? null,
        semanticDigest: groupEntry.semanticDigest ?? null,
        evidence: groupEntry.evidence,
        evidenceDigest: groupEntry.evidenceDigest,
        textArtifact: { path: groupEntry.artifact.path, beforeExists: groupEntry.artifact.beforeExists, beforeContent: groupEntry.artifact.beforeContent, afterContent: groupEntry.artifact.afterContent },
      });
      await assertIdentitiesCurrent(groupEntry, refreshIdentities);
      const initialStates = await readStates({ readSource, readArtifact });
      if (!matchesBefore(initialStates.source, groupEntry.source)
        || !matchesBefore(initialStates.artifact, groupEntry.artifact)) {
        fail("ENTRY_ACTION_GROUP_CONFLICTED");
      }
      group = await groupJournal.begin(groupEntry);
    } else {
      group = await groupJournal.begin(groupEntry);
    }

    if (group.stage === "result_published") return group;
    if (group.stage === "verified") {
      await publishResultIdempotently({ idempotencyKey: groupEntry.idempotencyKey, runId: groupEntry.runId });
      return groupJournal.advance(groupEntry, "result_published");
    }

    let states = await readStates({ readSource, readArtifact });
    assertRecoverable(group, states);
    if (stageAtLeast(group.stage, "artifact_committed")) {
      await assertChildComplete(childJournal, group.artifact.childEntry.idempotencyKey);
    }
    if (stageAtLeast(group.stage, "source_committed")) {
      await assertChildComplete(childJournal, group.source.childEntry.idempotencyKey);
    }

    if (group.stage === "group_intent") {
      await resumeChild({
        journal: childJournal,
        entry: group.artifact.childEntry,
        expected: group.artifact,
        state: states.artifact,
        beforeWrite: async () => {
          await verifyOwnership(group.ownership);
          await verifyAuthority({
            ruleDigest: group.ruleDigest,
            operation: group.operation ?? "proposal",
            createContractDigest: group.createContractDigest ?? null,
            candidateId: group.candidateId ?? null,
            semanticDigest: group.semanticDigest ?? null,
            evidence: group.evidence,
            evidenceDigest: group.evidenceDigest,
            textArtifact: { path: group.artifact.path, beforeExists: group.artifact.beforeExists, beforeContent: group.artifact.beforeContent, afterContent: group.artifact.afterContent },
          });
          await assertIdentitiesCurrent(group, refreshIdentities);
        },
        write: () => writeArtifact(group.artifact.afterContent),
        read: readArtifact,
      });
      group = await groupJournal.advance(groupEntry, "artifact_committed");
      states = await readStates({ readSource, readArtifact });
      assertRecoverable(group, states);
    }

    if (group.stage === "artifact_committed") {
      await resumeChild({
        journal: childJournal,
        entry: group.source.childEntry,
        expected: group.source,
        state: states.source,
        beforeWrite: async () => {
          await verifyOwnership(group.ownership);
          await verifyAuthority({
            ruleDigest: group.ruleDigest,
            operation: group.operation ?? "proposal",
            createContractDigest: group.createContractDigest ?? null,
            candidateId: group.candidateId ?? null,
            semanticDigest: group.semanticDigest ?? null,
            evidence: group.evidence,
            evidenceDigest: group.evidenceDigest,
            textArtifact: { path: group.artifact.path, beforeExists: group.artifact.beforeExists, beforeContent: group.artifact.beforeContent, afterContent: group.artifact.afterContent },
          });
          await assertIdentitiesCurrent(group, refreshIdentities);
        },
        write: () => writeSource(group.source.afterContent),
        read: readSource,
      });
      group = await groupJournal.advance(groupEntry, "source_committed");
      states = await readStates({ readSource, readArtifact });
      assertRecoverable(group, states);
    }

    if (group.stage === "source_committed") {
      assertAfter(states.artifact, group.artifact);
      assertAfter(states.source, group.source);
      group = await groupJournal.advance(groupEntry, "verified");
    }
    if (group.stage === "verified") {
      await publishResultIdempotently({ idempotencyKey: groupEntry.idempotencyKey, runId: groupEntry.runId });
      group = await groupJournal.advance(groupEntry, "result_published");
    }
    return group;
  });
}

async function resumeChild({ journal, entry, expected, state, beforeWrite, write, read }) {
  let current = await journal.begin({ ...entry, stage: "commit_intent" });
  if (current.stage === "commit_intent") {
    if (matchesBefore(state, expected)) {
      await beforeWrite();
      const latest = stateOf(await read());
      if (!matchesBefore(latest, expected)) fail("ENTRY_ACTION_GROUP_FAILED_NEEDS_RECOVERY");
      await write();
      state = stateOf(await read());
    }
    assertAfter(state, expected);
    current = await journal.advance(entry, "source_replaced");
  }
  if (current.stage === "source_replaced") {
    assertAfter(stateOf(await read()), expected);
    current = await journal.advance(entry, "verified");
  }
  if (current.stage === "verified") {
    current = await journal.advance(entry, "result_published");
  }
  if (current.stage !== "result_published") fail("ENTRY_ACTION_GROUP_CHILD_INCOMPLETE");
}

async function assertChildComplete(journal, idempotencyKey) {
  try {
    const child = await journal.read(idempotencyKey);
    if (child.stage !== "result_published") fail("ENTRY_ACTION_GROUP_CHILD_EVIDENCE_INVALID");
  } catch (cause) {
    if (cause?.code === "ENTRY_ACTION_GROUP_CHILD_EVIDENCE_INVALID") throw cause;
    fail("ENTRY_ACTION_GROUP_CHILD_EVIDENCE_INVALID");
  }
}

async function assertIdentitiesCurrent(group, refreshIdentities) {
  const identities = await refreshIdentities({
    sourcePath: group.source.path,
    artifactPath: group.artifact.path,
  });
  if (identities?.source?.canonicalFileKey !== group.source.canonicalFileKey
    || identities?.artifact?.canonicalFileKey !== group.artifact.canonicalFileKey) {
    fail("ENTRY_ACTION_GROUP_IDENTITY_STALE");
  }
}

function assertRecoverable(group, states) {
  const sourceBefore = matchesBefore(states.source, group.source);
  const sourceAfter = matchesAfter(states.source, group.source);
  const artifactBefore = matchesBefore(states.artifact, group.artifact);
  const artifactAfter = matchesAfter(states.artifact, group.artifact);
  const valid = {
    group_intent: (sourceBefore && artifactBefore) || (sourceBefore && artifactAfter) || (sourceAfter && artifactAfter),
    artifact_committed: artifactAfter && (sourceBefore || sourceAfter),
    source_committed: sourceAfter && artifactAfter,
    verified: sourceAfter && artifactAfter,
    result_published: sourceAfter && artifactAfter,
  }[group.stage];
  if (!valid) fail("ENTRY_ACTION_GROUP_FAILED_NEEDS_RECOVERY");
}

function stageAtLeast(stage, expected) {
  const order = ["group_intent", "artifact_committed", "source_committed", "verified", "result_published"];
  return order.indexOf(stage) >= order.indexOf(expected);
}

async function readStates({ readSource, readArtifact }) {
  return {
    source: stateOf(await readSource()),
    artifact: stateOf(await readArtifact()),
  };
}

function assertRuntimeInputs(value) {
  for (const key of ["coordinator", "groupJournal", "childJournal", "groupEntry", "sourceIdentity", "artifactIdentity"]) {
    if (!value[key]) fail("ENTRY_ACTION_GROUP_INPUT_INVALID");
  }
  for (const key of ["verifyOwnership", "verifyAuthority", "refreshIdentities", "publishResultIdempotently", "readSource", "writeSource", "readArtifact", "writeArtifact"]) {
    if (typeof value[key] !== "function") fail("ENTRY_ACTION_GROUP_INPUT_INVALID");
  }
  if (value.groupEntry.source?.canonicalFileKey !== value.sourceIdentity.canonicalFileKey
    || value.groupEntry.artifact?.canonicalFileKey !== value.artifactIdentity.canonicalFileKey) {
    fail("ENTRY_ACTION_GROUP_IDENTITY_INVALID");
  }
}

function assertLease(lease, canonicalFileKey, runId) {
  if (!lease || lease.canonicalFileKey !== canonicalFileKey || lease.runId !== runId
    || typeof lease.ownerToken !== "string" || typeof lease.ownerHash !== "string"
    || !Number.isSafeInteger(lease.fencingToken) || lease.fencingToken < 1
    || typeof lease.jobInstanceId !== "string") {
    fail("ENTRY_ACTION_GROUP_OWNERSHIP_INVALID");
  }
}

function stateOf(value) {
  if (value === null) return { exists: false, digest: null };
  if (typeof value !== "string") fail("ENTRY_ACTION_GROUP_READ_INVALID");
  return { exists: true, digest: digest(value) };
}
function matchesBefore(state, target) { return state.exists === target.beforeExists && state.digest === target.beforeDigest; }
function matchesAfter(state, target) { return state.exists === target.afterExists && state.digest === target.afterDigest; }
function assertAfter(state, target) { if (!matchesAfter(state, target)) fail("ENTRY_ACTION_GROUP_FAILED_NEEDS_RECOVERY"); }
function serializePrepared(prepared) {
  return prepared.format === "csv" ? serializeCsv(prepared.root) : serializeJson(prepared.root);
}
function etag(text) { return `"${digest(text)}"`; }
function digest(text) { return crypto.createHash("sha256").update(text, "utf8").digest("hex"); }
function fail(code) { throw Object.assign(new Error(code), { code }); }
