import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createAuthoritySnapshot } from "../src/entry-action-authority.mjs";
import {
  commitEntryActionProposal,
  createProposalCommitJournalEntry,
  prepareEntryActionProposalCommit,
} from "../src/entry-action-proposal-commit.mjs";
import { createCommitJournal } from "../src/commit-journal.mjs";

const text = '[{"__entry_id":"row-1","item_id":"item_alpha","name":"Alpha","notes":""}]';
const etag = (value) => `"${crypto.createHash("sha256").update(value, "utf8").digest("hex")}"`;
const digest = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const profile = {
  etag: '"profile"',
  rules: [{
    id: "rename",
    enabled: true,
    targets: [{
      file: "data/items.json",
      collection: "$",
    }],
  }],
};
const row = { __entry_id: "row-1", item_id: "item_alpha", name: "Alpha", notes: "" };
const snapshot = createAuthoritySnapshot({ profile, actionId: "rename", file: "data/items.json", collection: "$", row });
const artifactProfile = {
  ...profile,
  rules: [{
    ...profile.rules[0],
    targets: [{ ...profile.rules[0].targets[0], textArtifact: {} }],
  }],
};
const artifactDocumentTarget = { primaryKeyField: "item_id", documentRoot: "docs/items", sourceValue: "item_alpha", path: "docs/items/item_alpha.md" };
const artifactSnapshot = createAuthoritySnapshot({ profile: artifactProfile, actionId: "rename", file: "data/items.json", collection: "$", row, documentTarget: artifactDocumentTarget });
const lease = {
  canonicalFileKey: "a".repeat(64),
  runId: "10000000-0000-4000-8000-000000000001",
  fencingToken: 1,
  ownerToken: "20000000-0000-4000-8000-000000000002",
  ownerHash: "b".repeat(64),
};
const changes = [
  { field: "name", beforeExists: true, before: "Alpha", afterExists: true, after: "Beta" },
  { field: "notes", beforeExists: true, before: "", afterExists: true, after: "Reviewed" },
];
const proposal = {
  version: 3,
  runId: lease.runId,
  actionId: "rename",
  sourcePath: "data/items.json",
  canonicalFileKey: lease.canonicalFileKey,
  collectionPath: "$",
  rowId: "row-1",
  baseDocumentEtag: etag(text),
  ruleDigest: snapshot.ruleDigest,
  fencingToken: 1,
  changes,
  textArtifact: null,
  summary: "rename",
};
const probeLease = () => ({ status: "owned", lease });

test("proposal preparation applies multiple authorized fields to a clone", async () => {
  const result = await prepareEntryActionProposalCommit({ proposal, lease, authoritySnapshot: snapshot, profile, documentText: text, probeLease });
  assert.equal(result.root[0].name, "Beta");
  assert.equal(result.root[0].notes, "Reviewed");
  assert.equal(JSON.parse(text)[0].name, "Alpha");
  const entry = createProposalCommitJournalEntry({
    proposal: result.proposal,
    lease,
    documentText: text,
    afterText: `${JSON.stringify(result.root, null, 2)}\n`,
  });
  assert.equal(entry.saveType, "proposal_commit");
  assert.match(entry.idempotencyKey, /^proposal_[0-9a-f]{64}$/);
  assert.equal(entry.changes.length, 2);
});

test("proposal preparation binds one authorized Markdown create or update", async () => {
  const afterContent = "# Alpha\n";
  const withArtifact = {
    ...proposal,
    ruleDigest: artifactSnapshot.ruleDigest,
    textArtifact: {
      id: "item-doc",
      path: "docs/items/item_alpha.md",
      beforeExists: false,
      beforeDigest: null,
      afterContent,
      afterDigest: digest(afterContent),
    },
  };
  const prepared = await prepareEntryActionProposalCommit({
    proposal: withArtifact,
    lease,
    authoritySnapshot: artifactSnapshot,
    profile: artifactProfile,
    documentTarget: artifactDocumentTarget,
    documentText: text,
    textArtifactCurrentText: null,
    probeLease,
  });
  assert.equal(prepared.textArtifact.beforeContent, null);
  assert.equal(prepared.textArtifact.afterContent, afterContent);
  await assert.rejects(() => commitEntryActionProposal({
    journal: createCommitJournal({ directory: path.resolve(os.tmpdir(), "unused-entry-action-journal") }),
    prepared,
    lease,
    documentText: text,
    writeText: async () => {},
    readText: async () => text,
  }), { code: "ENTRY_ACTION_GROUP_COMMIT_REQUIRED" });
});

test("proposal preparation fails closed on stale ownership, document, row or artifact", async () => {
  await assert.rejects(() => prepareEntryActionProposalCommit({ proposal, lease, authoritySnapshot: snapshot, profile, documentText: text, probeLease: () => ({ status: "absent" }) }), { code: "ENTRY_ACTION_PROPOSAL_OWNERSHIP_STALE" });
  await assert.rejects(() => prepareEntryActionProposalCommit({ proposal: { ...proposal, baseDocumentEtag: '"old"' }, lease, authoritySnapshot: snapshot, profile, documentText: text, probeLease }), { code: "ENTRY_ACTION_PROPOSAL_DOCUMENT_STALE" });
  await assert.rejects(() => prepareEntryActionProposalCommit({ proposal: { ...proposal, changes: [{ ...changes[0], before: "Other" }] }, lease, authoritySnapshot: snapshot, profile, documentText: text, probeLease }), { code: "ENTRY_ACTION_PROPOSAL_BEFORE_MISMATCH" });
  const beforeContent = "# Before\n";
  const afterContent = "# After\n";
  const artifactProposal = {
    ...proposal,
    ruleDigest: artifactSnapshot.ruleDigest,
    textArtifact: {
      id: "item-doc",
      path: "docs/items/item_alpha.md",
      beforeExists: true,
      beforeDigest: digest(beforeContent),
      afterContent,
      afterDigest: digest(afterContent),
    },
  };
  await assert.rejects(() => prepareEntryActionProposalCommit({
    proposal: artifactProposal,
    lease,
    authoritySnapshot: artifactSnapshot,
    profile: artifactProfile,
    documentTarget: artifactDocumentTarget,
    documentText: text,
    textArtifactCurrentText: "# External\n",
    probeLease,
  }), { code: "ENTRY_ACTION_TEXT_ARTIFACT_BEFORE_MISMATCH" });
});

test("proposal preparation allows a skill to choose any existing row field", async () => {
  const duplicateText = '[{"__entry_id":"row-1","item_id":"item_alpha","name":"Alpha","notes":""},{"__entry_id":"row-2","item_id":"item_beta","name":"Beta","notes":""}]';
  const duplicateProposal = {
    ...proposal,
    baseDocumentEtag: etag(duplicateText),
    changes: [changes[0]],
  };
  const prepared = await prepareEntryActionProposalCommit({
    proposal: duplicateProposal,
    lease,
    authoritySnapshot: snapshot,
    profile,
    documentText: duplicateText,
    probeLease,
  });
  assert.equal(prepared.root[0].name, "Beta");
});

test("proposal commit writes the compound row through the existing child journal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "proposal-journal-"));
  try {
    const prepared = await prepareEntryActionProposalCommit({ proposal, lease, authoritySnapshot: snapshot, profile, documentText: text, probeLease });
    let source = text;
    let published = 0;
    const result = await commitEntryActionProposal({
      journal: createCommitJournal({ directory: root }),
      prepared,
      lease,
      documentText: text,
      writeText: async (next) => { source = next; },
      readText: async () => source,
      publishResult: async () => { published += 1; },
    });
    assert.equal(JSON.parse(source)[0].name, "Beta");
    assert.equal(JSON.parse(source)[0].notes, "Reviewed");
    assert.equal(published, 1);
    assert.equal(result.entry.saveType, "proposal_commit");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
