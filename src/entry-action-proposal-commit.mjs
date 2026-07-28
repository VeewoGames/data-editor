import crypto from "node:crypto";
import { assertAuthorityCurrent } from "./entry-action-authority.mjs";
import { validateEntryActionProposal } from "./entry-action-proposal.mjs";
import { buildDocumentModel, getRows } from "./document-model.mjs";
import { buildDocumentStore, getSourceLocatorByRowId } from "./model/document-store.mjs";
import { setAuthorizedCellValueByRowId } from "./model/writeback-adapter.mjs";
import { serializeJson } from "./json-codec.mjs";
import { parseCsv, serializeCsv } from "./csv-codec.mjs";
import { executeJournaledDocumentCommit } from "./document-commit-executor.mjs";

export async function prepareEntryActionProposalCommit({ proposal, lease, authoritySnapshot, policy, profile, documentText, format = "json", documentId = "document", probeLease }) {
  const value = validateEntryActionProposal(proposal);
  if (!lease || value.canonicalFileKey !== lease.canonicalFileKey || value.runId !== lease.runId || value.fencingToken !== lease.fencingToken) fail("ENTRY_ACTION_PROPOSAL_OWNERSHIP_STALE");
  const current = typeof probeLease === "function" ? await probeLease(lease) : null;
  if (!current || current.status !== "owned" || current.lease?.ownerToken !== lease.ownerToken || current.lease?.ownerHash !== lease.ownerHash || current.lease?.fencingToken !== lease.fencingToken) fail("ENTRY_ACTION_PROPOSAL_OWNERSHIP_STALE");
  if (etag(documentText) !== value.baseDocumentEtag) fail("ENTRY_ACTION_PROPOSAL_DOCUMENT_STALE");
  if (authoritySnapshot.authorityDigest !== value.authorityDigest || authoritySnapshot.automationProfileEtag !== value.automationProfileEtag) fail("ENTRY_ACTION_AUTHORITY_STALE");
  const rule = assertAuthorityCurrent({ snapshot: authoritySnapshot, policy, profile, field: value.change.field, value: value.change.after });
  const source = format === "csv" ? parseCsv(documentText) : JSON.parse(documentText);
  const model = buildDocumentModel(source, format, value.sourcePath);
  const store = buildDocumentStore({ documentId, model });
  const locator = getSourceLocatorByRowId(store, value.collectionPath, value.rowId);
  const row = getRows(model, value.collectionPath)[locator.sourceIndex];
  if (!row || !Object.hasOwn(row, value.change.field) || !Object.is(row[value.change.field], value.change.before)) fail("ENTRY_ACTION_PROPOSAL_BEFORE_MISMATCH");
  if (rule.uniqueScope === "collection" && getRows(model, value.collectionPath).some((candidate, index) => index !== locator.sourceIndex && Object.is(candidate?.[value.change.field], value.change.after))) fail("ENTRY_ACTION_PROPOSAL_UNIQUE_CONFLICT");
  setAuthorizedCellValueByRowId({ model, store, policy, file: value.sourcePath, collectionPath: value.collectionPath, rowId: value.rowId, fieldName: value.change.field, value: value.change.after });
  return { proposal: value, model, root: model.root, documentEtag: etag(format === "csv" ? serializeCsv(model.root) : serializeJson(model.root)), format };
}

/** Executes the already-authorized JSON proposal through the same durable journal as document saves. */
export async function commitEntryActionProposal({ journal, prepared, lease, documentText, writeText, readText, publishResult }) {
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
    change: structuredClone(value.change),
  };
}

function etag(text) { return `"${crypto.createHash("sha256").update(text, "utf8").digest("hex")}"`; }
function digest(text) { return crypto.createHash("sha256").update(text, "utf8").digest("hex"); }
function fail(code) { throw Object.assign(new Error(code), { code }); }
