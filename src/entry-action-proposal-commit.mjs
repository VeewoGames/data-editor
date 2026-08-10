import crypto from "node:crypto";
import { assertAuthorityCurrent } from "./entry-action-authority.mjs";
import { validateEntryActionProposal } from "./entry-action-proposal.mjs";
import { buildDocumentModel, getRows } from "./document-model.mjs";
import { buildDocumentStore, getSourceLocatorByRowId } from "./model/document-store.mjs";
import { setAuthorizedCellValueByRowId } from "./model/writeback-adapter.mjs";
import { serializeJson } from "./json-codec.mjs";
import { parseCsv, serializeCsv } from "./csv-codec.mjs";
import { executeJournaledDocumentCommit } from "./document-commit-executor.mjs";
import { assertEntryActionResultPolicies } from "./entry-action-contracts.mjs";

export async function prepareEntryActionProposalCommit({
  proposal,
  lease,
  authoritySnapshot,
  contract = null,
  profile,
  documentTarget = null,
  documentText,
  textArtifactCurrentText = undefined,
  format = "json",
  documentId = "document",
  probeLease,
  evidence = [],
}) {
  const value = validateEntryActionProposal(proposal);
  if (stableJson(evidence) !== stableJson(value.evidence)) fail("ENTRY_ACTION_PROPOSAL_EVIDENCE_MISMATCH");
  if (contract) assertEntryActionResultPolicies(contract, { textArtifact: value.textArtifact, evidence: value.evidence });
  if (!lease || value.canonicalFileKey !== lease.canonicalFileKey || value.runId !== lease.runId || value.fencingToken !== lease.fencingToken) fail("ENTRY_ACTION_PROPOSAL_OWNERSHIP_STALE");
  const current = typeof probeLease === "function" ? await probeLease(lease) : null;
  if (!current || current.status !== "owned" || current.lease?.ownerToken !== lease.ownerToken || current.lease?.ownerHash !== lease.ownerHash || current.lease?.fencingToken !== lease.fencingToken) fail("ENTRY_ACTION_PROPOSAL_OWNERSHIP_STALE");
  if (etag(documentText) !== value.baseDocumentEtag) fail("ENTRY_ACTION_PROPOSAL_DOCUMENT_STALE");
  if (authoritySnapshot.ruleDigest !== value.ruleDigest) fail("ENTRY_ACTION_AUTHORITY_STALE");
  const source = format === "csv" ? parseCsv(documentText) : JSON.parse(documentText);
  const model = buildDocumentModel(source, format, value.sourcePath);
  const store = buildDocumentStore({ documentId, model });
  const locator = getSourceLocatorByRowId(store, value.collectionPath, value.rowId);
  const row = getRows(model, value.collectionPath)[locator.sourceIndex];
  if (!row) fail("ENTRY_ACTION_PROPOSAL_BEFORE_MISMATCH");
  const authority = assertAuthorityCurrent({
    snapshot: authoritySnapshot,
    profile,
    changes: value.changes,
    textArtifact: value.textArtifact,
    row,
    contract,
    documentTarget,
  });
  for (const [index, change] of value.changes.entries()) {
    if (!Object.hasOwn(row, change.field) || !deepEqual(row[change.field], change.before)) fail("ENTRY_ACTION_PROPOSAL_BEFORE_MISMATCH");
    const rule = authority.fieldRules[index];
    if (rule.uniqueScope === "collection" && getRows(model, value.collectionPath).some((candidate, candidateIndex) => candidateIndex !== locator.sourceIndex && deepEqual(candidate?.[change.field], change.after))) fail("ENTRY_ACTION_PROPOSAL_UNIQUE_CONFLICT");
  }
  for (const change of value.changes) {
    setAuthorizedCellValueByRowId({
      model,
      store,
      collectionPath: value.collectionPath,
      rowId: value.rowId,
      fieldName: change.field,
      value: change.after,
    });
  }
  const textArtifact = prepareTextArtifact(value.textArtifact, textArtifactCurrentText);
  if (contract && textArtifact) assertEntryActionResultPolicies(contract, { textArtifact, evidence: value.evidence });
  return {
    proposal: value,
    model,
    root: model.root,
    documentEtag: etag(format === "csv" ? serializeCsv(model.root) : serializeJson(model.root)),
    format,
    textArtifact,
    evidence: structuredClone(value.evidence),
  };
}

/** Executes the already-authorized JSON proposal through the same durable journal as document saves. */
export async function commitEntryActionProposal({ journal, prepared, lease, documentText, writeText, readText, publishResult }) {
  if (prepared.textArtifact !== null) fail("ENTRY_ACTION_GROUP_COMMIT_REQUIRED");
  const afterText = prepared.format === "csv" ? serializeCsv(prepared.root) : serializeJson(prepared.root);
  const entry = createProposalCommitJournalEntry({ proposal: prepared.proposal, lease, documentText, afterText });
  await executeJournaledDocumentCommit({
    journal,
    entry,
    replace: () => writeText(afterText),
    verify: async () => {
      const persisted = await readText();
      if (etag(persisted) !== entry.newEtag || digest(persisted) !== entry.afterDigest) fail("ENTRY_ACTION_PROPOSAL_COMMIT_VERIFY_FAILED");
    },
    publishResult,
  });
  return { entry, documentEtag: entry.newEtag };
}

export function createProposalCommitJournalEntry({ proposal, lease, documentText, afterText }) {
  const value = validateEntryActionProposal(proposal);
  const proposalDigest = digest(JSON.stringify(value));
  return {
    idempotencyKey: `proposal_${digest(`${value.runId}:${proposalDigest}`)}`,
    saveType: "proposal_commit",
    canonicalFileKey: value.canonicalFileKey,
    baseEtag: value.baseDocumentEtag,
    newEtag: etag(afterText),
    beforeDigest: digest(documentText),
    afterDigest: digest(afterText),
    requestDigest: proposalDigest,
    runId: value.runId,
    ownerToken: lease.ownerToken,
    fencingToken: value.fencingToken,
    rowId: value.rowId,
    proposalDigest,
    changes: structuredClone(value.changes),
  };
}

function etag(text) { return `"${crypto.createHash("sha256").update(text, "utf8").digest("hex")}"`; }
function digest(text) { return crypto.createHash("sha256").update(text, "utf8").digest("hex"); }
function deepEqual(left, right) { return stableJson(left) === stableJson(right); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function prepareTextArtifact(artifact, currentText) {
  if (artifact === null) return null;
  if (currentText !== null && typeof currentText !== "string") fail("ENTRY_ACTION_TEXT_ARTIFACT_STATE_REQUIRED");
  const exists = typeof currentText === "string";
  if (artifact.beforeExists !== exists) fail("ENTRY_ACTION_TEXT_ARTIFACT_BEFORE_MISMATCH");
  if (exists && digest(currentText) !== artifact.beforeDigest) fail("ENTRY_ACTION_TEXT_ARTIFACT_BEFORE_MISMATCH");
  return {
    ...structuredClone(artifact),
    beforeContent: currentText,
  };
}
function fail(code) { throw Object.assign(new Error(code), { code }); }
