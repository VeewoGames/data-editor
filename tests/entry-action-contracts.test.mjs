import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { assertEntryActionChanges, assertEntryActionPredicate, assertEntryActionResultPolicies, validateEntryActionContracts } from "../src/entry-action-contracts.mjs";

function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function contract() {
  const value = { contractId: "fixture.review.v1", version: 1, predicate: { all: [{ field: "status", op: "eq", value: "ready" }] }, writableFields: ["rating", "status"], legalTransitions: [{ field: "status", from: ["ready"], to: ["approved", "changes"] }], textArtifactPolicy: {}, evidencePolicy: {}, resultPolicy: "proposal", createAuthority: null };
  return { ...value, digest: crypto.createHash("sha256").update(canonical(value), "utf8").digest("hex") };
}

test("action contracts validate predicate, allowlist, transitions and digest", () => {
  const current = validateEntryActionContracts({ version: 1, contracts: [contract()] }).contracts[0];
  assert.doesNotThrow(() => assertEntryActionPredicate(current.predicate, { status: "ready" }));
  assert.doesNotThrow(() => assertEntryActionChanges(current, [{ field: "status", before: "ready", after: "approved" }]));
  assert.throws(() => assertEntryActionChanges(current, [{ field: "notes", before: "", after: "x" }]), { code: "ENTRY_ACTION_FIELD_FORBIDDEN" });
  assert.throws(() => assertEntryActionChanges(current, [{ field: "status", before: "ready", after: "draft" }]), { code: "ENTRY_ACTION_TRANSITION_ILLEGAL" });
  assert.throws(() => validateEntryActionContracts({ version: 1, contracts: [{ ...contract(), resultPolicy: "result-only" }] }), { code: "ENTRY_ACTION_CONTRACT_DIGEST_MISMATCH" });
});

test("artifact and evidence policies are strict and block invalid content", () => {
  const base = contract(); const { digest: _digest, ...unsigned } = base;
  const policy = { ...unsigned, textArtifactPolicy: { required: true, maxBytes: 4, createOnly: true, allowedExtensions: [".md"] }, evidencePolicy: { required: true, minItems: 1, maxItems: 1, allowedKinds: ["test"] } };
  const current = validateEntryActionContracts({ version: 1, contracts: [{ ...policy, digest: crypto.createHash("sha256").update(canonical(policy), "utf8").digest("hex") }] }).contracts[0];
  assert.doesNotThrow(() => assertEntryActionResultPolicies(current, { textArtifact: { path: "a.md", beforeExists: false, afterContent: "four" }, evidence: [{ kind: "test", ref: "run/1", digest: "a".repeat(64) }] }));
  assert.throws(() => assertEntryActionResultPolicies(current, { textArtifact: { path: "a.md", beforeExists: false, afterContent: "oversize" }, evidence: [{ kind: "test", ref: "run/1", digest: "a".repeat(64) }] }), { code: "ENTRY_ACTION_TEXT_ARTIFACT_POLICY_FAILED" });
  assert.throws(() => assertEntryActionResultPolicies(current, { textArtifact: { path: "a.md", beforeExists: false, afterContent: "four" }, evidence: [{ kind: "forged", ref: "run/1", digest: "a".repeat(64) }] }), { code: "ENTRY_ACTION_EVIDENCE_POLICY_FAILED" });
  const bad = { ...unsigned, textArtifactPolicy: { unexpected: true } }; bad.digest = crypto.createHash("sha256").update(canonical(bad), "utf8").digest("hex");
  assert.throws(() => validateEntryActionContracts({ version: 1, contracts: [bad] }), { code: "ENTRY_ACTION_CONTRACT_INVALID" });
});

test("paired legal transitions require both fields to change to the configured pair", () => {
  const base = contract(); const { digest: _digest, ...unsigned } = base;
  const paired = {
    ...unsigned,
    writableFields: ["rating", "status"],
    legalTransitions: [
      { field: "status", from: ["ready"], to: ["approved"], requires: [{ field: "rating", from: [null], to: ["pass"] }] },
      { field: "rating", from: [null], to: ["pass"], requires: [{ field: "status", from: ["ready"], to: ["approved"] }] },
    ],
  };
  const current = validateEntryActionContracts({ version: 1, contracts: [{ ...paired, digest: crypto.createHash("sha256").update(canonical(paired), "utf8").digest("hex") }] }).contracts[0];
  const both = [
    { field: "status", before: "ready", after: "approved" },
    { field: "rating", before: null, after: "pass" },
  ];
  assert.doesNotThrow(() => assertEntryActionChanges(current, both, { status: "ready", rating: null }));
  assert.throws(() => assertEntryActionChanges(current, [both[0]], { status: "ready", rating: null }), { code: "ENTRY_ACTION_TRANSITION_ILLEGAL" });
  assert.throws(() => assertEntryActionChanges(current, [both[1]], { status: "ready", rating: null }), { code: "ENTRY_ACTION_TRANSITION_ILLEGAL" });
  assert.throws(() => assertEntryActionChanges(current, [both[0], { ...both[1], after: "fail" }], { status: "ready", rating: null }), { code: "ENTRY_ACTION_TRANSITION_ILLEGAL" });
});

test("pattern transitions permit only matching strings from an exact prior value", () => {
  const base = contract(); const { digest: _digest, ...unsigned } = base;
  const pattern = { ...unsigned, writableFields: ["name"], legalTransitions: [{ field: "name", from: [""], toPattern: "^[A-Za-z][A-Za-z0-9 _-]{1,31}$" }] };
  const signed = (value) => ({ ...value, digest: crypto.createHash("sha256").update(canonical(value), "utf8").digest("hex") });
  const current = validateEntryActionContracts({ version: 1, contracts: [signed(pattern)] }).contracts[0];
  assert.doesNotThrow(() => assertEntryActionChanges(current, [{ field: "name", before: "", after: "Valid Name" }], { name: "" }));
  assert.throws(() => assertEntryActionChanges(current, [{ field: "name", before: "Existing", after: "Replacement" }], { name: "Existing" }), { code: "ENTRY_ACTION_TRANSITION_ILLEGAL" });
  assert.throws(() => assertEntryActionChanges(current, [{ field: "name", before: "", after: "!" }], { name: "" }), { code: "ENTRY_ACTION_TRANSITION_ILLEGAL" });
  assert.throws(() => assertEntryActionChanges(current, [{ field: "name", before: "", after: 42 }], { name: "" }), { code: "ENTRY_ACTION_TRANSITION_ILLEGAL" });
  for (const transition of [
    { field: "name", from: [""], to: ["fixed"], toPattern: "^.+$" },
    { field: "name", from: [""] },
    { field: "name", from: [""], toPattern: "[" },
  ]) {
    const invalid = { ...unsigned, writableFields: ["name"], legalTransitions: [transition] };
    assert.throws(() => validateEntryActionContracts({ version: 1, contracts: [signed(invalid)] }), { code: "ENTRY_ACTION_CONTRACT_INVALID" });
  }
});
