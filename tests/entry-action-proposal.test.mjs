import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { validateEntryActionProposal } from "../src/entry-action-proposal.mjs";

const digest = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const proposal = {
  version: 3,
  runId: "10000000-0000-4000-8000-000000000001",
  actionId: "recheck",
  sourcePath: "fixtures/items.json",
  canonicalFileKey: "a".repeat(64),
  collectionPath: "items",
  rowId: "entry",
  baseDocumentEtag: "\"doc\"",
  ruleDigest: "b".repeat(64),
  fencingToken: 1,
  changes: [
    { field: "name", beforeExists: true, before: "Alpha", afterExists: true, after: "Beta" },
    { field: "notes", beforeExists: true, before: "", afterExists: true, after: "Reviewed" },
  ],
  textArtifact: null,
  summary: "rename",
  evidence: [],
};

test("proposal accepts multiple changes for one stable row", () => {
  assert.deepEqual(validateEntryActionProposal(proposal), proposal);
});

test("proposal accepts one normalized Markdown artifact with bound digests", () => {
  const afterContent = "# Skill\n";
  const withArtifact = {
    ...proposal,
    textArtifact: {
      id: "skill-doc",
      path: "docs/skills/entry.md",
      beforeExists: false,
      beforeDigest: null,
      afterContent,
      afterDigest: digest(afterContent),
    },
  };
  assert.deepEqual(validateEntryActionProposal(withArtifact), withArtifact);
});

test("proposal rejects ambiguous, duplicate, no-op, escaping and unbound content", () => {
  const invalid = (error) => error?.code === "ENTRY_ACTION_PROPOSAL_INVALID";
  assert.throws(() => validateEntryActionProposal({ ...proposal, secondTarget: "x" }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, version: 1 }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, runId: "../../escape" }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, ruleDigest: "not-a-digest" }), invalid);
  const { evidence: _evidence, ...withoutEvidence } = proposal;
  assert.throws(() => validateEntryActionProposal(withoutEvidence), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, evidence: [{ kind: "test", ref: "run/1", digest: "bad" }] }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, evidence: [{ kind: "test", ref: "run/1", digest: "c".repeat(64), extra: true }] }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, changes: [] }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, changes: [proposal.changes[0], proposal.changes[0]] }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, changes: [{ ...proposal.changes[0], after: "Alpha" }] }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, changes: [{ ...proposal.changes[0], beforeExists: false, before: null }] }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, changes: [{ ...proposal.changes[0], afterExists: false, after: null }] }), invalid);
  const afterContent = "# Skill\n";
  const artifact = {
    id: "skill-doc",
    path: "../escape.md",
    beforeExists: false,
    beforeDigest: null,
    afterContent,
    afterDigest: digest(afterContent),
  };
  assert.throws(() => validateEntryActionProposal({ ...proposal, textArtifact: artifact }), invalid);
  assert.throws(() => validateEntryActionProposal({
    ...proposal,
    textArtifact: { ...artifact, path: "docs/skill.md", afterDigest: "c".repeat(64) },
  }), invalid);
});
