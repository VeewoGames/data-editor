import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createAuthoritySnapshot } from "../src/entry-action-authority.mjs";
import { createProposalCommitJournalEntry, commitEntryActionProposal, prepareEntryActionProposalCommit } from "../src/entry-action-proposal-commit.mjs";
import { createCommitJournal } from "../src/commit-journal.mjs";

const text = '[{"__entry_id":"row-1","name":"Alpha"}]';
const digest = (value) => `"${crypto.createHash("sha256").update(value, "utf8").digest("hex")}"`;
const policy = { version: 1, targets: [{ file: "data/items.json", collection: "$", writableFields: { name: { type: "string", nullable: false, uniqueScope: "none", validator: "non_empty_string" } } }] };
const profile = { etag: '"profile"', rules: [{ id: "rename", enabled: true, targets: [{ file: "data/items.json", collection: "$", writableFields: ["name"] }] }] };
const snapshot = createAuthoritySnapshot({ policy, profile, actionId: "rename", file: "data/items.json", collection: "$" });
const lease = { canonicalFileKey: "a".repeat(64), runId: "10000000-0000-4000-8000-000000000001", fencingToken: 1, ownerToken: "20000000-0000-4000-8000-000000000002", ownerHash: "b".repeat(64) };
const proposal = { version: 1, runId: lease.runId, actionId: "rename", sourcePath: "data/items.json", canonicalFileKey: lease.canonicalFileKey, collectionPath: "$", rowId: "row-1", baseDocumentEtag: digest(text), automationProfileEtag: profile.etag, authorityDigest: snapshot.authorityDigest, fencingToken: 1, change: { field: "name", beforeExists: true, before: "Alpha", afterExists: true, after: "Beta" }, summary: "rename" };
const probeLease = () => ({ status: "owned", lease });

test("proposal commit preparation requires current ownership, authority, etag and stable row before mutating a clone", async () => {
  const result = await prepareEntryActionProposalCommit({ proposal, lease, authoritySnapshot: snapshot, policy, profile, documentText: text, probeLease });
  assert.equal(result.root[0].name, "Beta");
  assert.equal(JSON.parse(text)[0].name, "Alpha");
  const entry = createProposalCommitJournalEntry({ proposal: result.proposal, lease, documentText: text, afterText: JSON.stringify(result.root, null, 2) + "\n" });
  assert.equal(entry.saveType, "proposal_commit");
  assert.match(entry.idempotencyKey, /^proposal_[0-9a-f]{64}$/);
  assert.equal(entry.change.after, "Beta");
});

test("proposal commit preparation fails closed on stale ownership, document or before value", async () => {
  await assert.rejects(() => prepareEntryActionProposalCommit({ proposal, lease, authoritySnapshot: snapshot, policy, profile, documentText: text, probeLease: () => ({ status: "absent" }) }), { code: "ENTRY_ACTION_PROPOSAL_OWNERSHIP_STALE" });
  await assert.rejects(() => prepareEntryActionProposalCommit({ proposal: { ...proposal, baseDocumentEtag: '"old"' }, lease, authoritySnapshot: snapshot, policy, profile, documentText: text, probeLease }), { code: "ENTRY_ACTION_PROPOSAL_DOCUMENT_STALE" });
  await assert.rejects(() => prepareEntryActionProposalCommit({ proposal: { ...proposal, change: { ...proposal.change, before: "Other" } }, lease, authoritySnapshot: snapshot, policy, profile, documentText: text, probeLease }), { code: "ENTRY_ACTION_PROPOSAL_BEFORE_MISMATCH" });
});

test("proposal commit preparation enforces collection uniqueness from policy", async () => {
  const uniquePolicy = { ...policy, targets: [{ ...policy.targets[0], writableFields: { name: { ...policy.targets[0].writableFields.name, uniqueScope: "collection" } } }] };
  const uniqueProfile = profile;
  const uniqueSnapshot = createAuthoritySnapshot({ policy: uniquePolicy, profile: uniqueProfile, actionId: "rename", file: "data/items.json", collection: "$" });
  const duplicateText = '[{"__entry_id":"row-1","name":"Alpha"},{"__entry_id":"row-2","name":"Beta"}]';
  const duplicateProposal = { ...proposal, baseDocumentEtag: digest(duplicateText), authorityDigest: uniqueSnapshot.authorityDigest, change: { ...proposal.change, after: "Beta" } };
  await assert.rejects(() => prepareEntryActionProposalCommit({ proposal: duplicateProposal, lease, authoritySnapshot: uniqueSnapshot, policy: uniquePolicy, profile: uniqueProfile, documentText: duplicateText, probeLease }), { code: "ENTRY_ACTION_PROPOSAL_UNIQUE_CONFLICT" });
});

test("proposal commit writes through the discriminated journal and publishes once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "proposal-journal-"));
  try {
    const prepared = await prepareEntryActionProposalCommit({ proposal, lease, authoritySnapshot: snapshot, policy, profile, documentText: text, probeLease });
    let source = text;
    let published = 0;
    const result = await commitEntryActionProposal({ journal: createCommitJournal({ directory: root }), prepared, lease, documentText: text, writeText: async (next) => { source = next; }, readText: async () => source, publishResult: async () => { published += 1; } });
    assert.equal(JSON.parse(source)[0].name, "Beta");
    assert.equal(published, 1);
    assert.equal(result.entry.saveType, "proposal_commit");
  } finally { await rm(root, { recursive: true, force: true }); }
});
