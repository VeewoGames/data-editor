import assert from "node:assert/strict";
import test from "node:test";
import { validateEntryActionProposal } from "../src/entry-action-proposal.mjs";
const proposal = { version: 1, runId: "10000000-0000-4000-8000-000000000001", actionId: "recheck", sourcePath: "fixtures/items.json", canonicalFileKey: "a".repeat(64), collectionPath: "items", rowId: "entry", baseDocumentEtag: "\"doc\"", automationProfileEtag: "\"profile\"", authorityDigest: "b".repeat(64), fencingToken: 1, change: { field: "name", beforeExists: true, before: "Alpha", afterExists: true, after: "Beta" }, summary: "rename" };
test("proposal accepts one explicit authorized-style field change", () => assert.deepEqual(validateEntryActionProposal(proposal), proposal));
test("proposal rejects extra targets, document payloads and ambiguous removals", () => {
  const invalid = (error) => error?.code === "ENTRY_ACTION_PROPOSAL_INVALID";
  assert.throws(() => validateEntryActionProposal({ ...proposal, secondTarget: "x" }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, version: 2 }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, runId: "../../escape" }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, authorityDigest: "not-a-digest" }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, change: { ...proposal.change, document: {} } }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, change: { ...proposal.change, beforeExists: false, before: null } }), invalid);
  assert.throws(() => validateEntryActionProposal({ ...proposal, change: { ...proposal.change, afterExists: false, after: null } }), invalid);
});
