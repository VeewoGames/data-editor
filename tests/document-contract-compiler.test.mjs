import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExactDocumentContractTokens,
  compileDocumentContract,
  documentContractAdmissionSnapshot,
  documentContractTokens,
  DocumentContractRuntimeError,
  evaluateDocumentContractDerivedOutputs,
  validateDocumentContractCandidate,
  validateDocumentContractTokenSet,
  verifyDocumentContractPostReplace,
} from "../src/document-contract-compiler.mjs";
import { DocumentContractGrammarError } from "../src/document-contract-grammar.mjs";
import { findCapabilityBindings } from "../src/project-capability-registry.mjs";

const binding = Object.freeze({ id: "workflow-shape", match: { dataSourceId: "data", path: "workflows.json", collection: "workflows" } });

function contract() {
  return {
    contract_version: 1,
    grammar_version: 1,
    collections: [{ path: "workflows", entryKind: "array", allowMissing: false }],
    invariants: [
      { id: "workflows-not-empty", scope: "document", assert: { op: "nonEmptyArray", path: "workflows" }, issue: { code: "WORKFLOWS_REQUIRED", message: "Workflows are required.", path: "workflows" } },
      { id: "workflow-id", scope: "entry", assert: { op: "required", path: "workflow_id" }, issue: { code: "WORKFLOW_ID_REQUIRED", message: "Workflow id is required.", path: "workflow_id" } },
      { id: "steps-not-empty", scope: "entry", assert: { op: "nonEmptyArray", path: "steps" }, issue: { code: "WORKFLOW_STEPS_REQUIRED", message: "Workflow steps are required.", path: "steps" } },
      { id: "branch-outcomes", scope: "entry", eachPath: "steps", when: { op: "equals", path: "type", value: "branch" }, assert: { op: "required", path: "on_match" }, issue: { code: "BRANCH_MATCH_REQUIRED", message: "Branch on_match is required.", path: "on_match" } },
      { id: "branch-fallback", scope: "entry", eachPath: "steps", when: { op: "equals", path: "type", value: "branch" }, assert: { op: "required", path: "on_no_match" }, issue: { code: "BRANCH_FALLBACK_REQUIRED", message: "Branch on_no_match is required.", path: "on_no_match" } },
    ],
    derivedOutputs: [{ id: "step_count", scope: "entry", kind: "count", path: "steps" }],
    savePolicy: { requireExactTokenSet: true, validateCandidate: true, blockingIssues: true },
  };
}

function resolution(value = contract()) {
  return { contracts: [{ binding, loaded: { compiled: compileDocumentContract(value, binding) } }] };
}

test("document-contract-v1 compiles only bounded declarative workflow rules", () => {
  const compiled = compileDocumentContract(contract(), binding);
  assert.equal(compiled.kind, "compiled");
  assert.equal(compiled.collection.path, "workflows");
  assert.equal(compiled.derivedOutputs[0].id, "step_count");
  assert.match(compiled.compiledContractDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(compiled.invariants[0].assert), true);
  assert.throws(
    () => compileDocumentContract({ ...contract(), invariants: [{ id: "unsafe", scope: "document", assert: { op: "javascript", path: "workflows" }, issue: { code: "BAD", message: "bad" } }] }, binding),
    (error) => error instanceof DocumentContractGrammarError && error.code === "DOCUMENT_CONTRACT_GRAMMAR_INVALID",
  );
  const multiCollection = contract();
  multiCollection.collections.push({ path: "archive", entryKind: "array", allowMissing: true });
  assert.throws(
    () => compileDocumentContract(multiCollection, binding),
    (error) => error instanceof DocumentContractGrammarError && error.code === "DOCUMENT_CONTRACT_COLLECTION_BINDING_MISMATCH",
  );
});

test("v1 grammar rejects malformed payloads instead of falling back to legacy", () => {
  assert.throws(
    () => compileDocumentContract({ contract_version: 1, grammar_version: 1 }, binding),
    (error) => error instanceof DocumentContractGrammarError && error.code === "DOCUMENT_CONTRACT_GRAMMAR_SCHEMA_INVALID",
  );
  assert.throws(
    () => compileDocumentContract({ ...contract(), invariants: [{ ...contract().invariants[0], when: { op: "equals", path: "workflows", value: ["nested"] } }] }, binding),
    (error) => error instanceof DocumentContractGrammarError && error.code === "DOCUMENT_CONTRACT_GRAMMAR_INVALID",
  );
  assert.throws(
    () => compileDocumentContract({ ...contract(), invariants: [{ ...contract().invariants[0], when: { op: "in", path: "workflows", values: [["nested"]] } }] }, binding),
    (error) => error instanceof DocumentContractGrammarError && error.code === "DOCUMENT_CONTRACT_GRAMMAR_INVALID",
  );
  assert.throws(
    () => compileDocumentContract({ ...contract(), invariants: [{ ...contract().invariants[0], when: { op: "equals", path: "workflows", value: "x".repeat(513) } }] }, binding),
    (error) => error instanceof DocumentContractGrammarError && error.code === "DOCUMENT_CONTRACT_GRAMMAR_INVALID",
  );
  assert.throws(
    () => compileDocumentContract({ ...contract(), invariants: [{ id: "open", scope: "document", assert: { op: "required", path: "workflows", ignored: true }, issue: { code: "BAD", message: "bad" } }] }, binding),
    (error) => error instanceof DocumentContractGrammarError && error.code === "DOCUMENT_CONTRACT_GRAMMAR_INVALID",
  );
});

test("candidate validation remains path-driven when a protected collection is missing or reshaped", () => {
  const compiled = resolution();
  const missing = validateDocumentContractCandidate(compiled, {});
  assert.deepEqual(missing.issues.map((item) => item.code), ["DOCUMENT_CONTRACT_COLLECTION_MISSING"]);
  const reshaped = validateDocumentContractCandidate(compiled, { workflows: {} });
  assert.deepEqual(reshaped.issues.map((item) => item.code), ["DOCUMENT_CONTRACT_COLLECTION_TYPE_INVALID"]);
  const invalid = validateDocumentContractCandidate(compiled, { workflows: [{ workflow_id: "onboard", steps: [{ type: "branch", on_match: "continue" }] }] });
  assert.deepEqual(invalid.issues.map((item) => item.code), ["BRANCH_FALLBACK_REQUIRED"]);
  assert.equal(invalid.issues[0].path, "workflows[0].steps[0].on_no_match");
});

test("collection uniqueBy produces an absolute duplicate issue path", () => {
  const withUnique = contract();
  withUnique.collections[0].uniqueBy = "workflow_id";
  withUnique.collections[0].uniqueIssue = { code: "WORKFLOW_ID_DUPLICATE", message: "Workflow ids must be unique.", path: "workflow_id" };
  const result = validateDocumentContractCandidate(resolution(withUnique), { workflows: [{ workflow_id: "same", steps: [{ type: "message" }] }, { workflow_id: "same", steps: [{ type: "delay" }] }] });
  assert.deepEqual(result.issues.map((item) => [item.code, item.path]), [["WORKFLOW_ID_DUPLICATE", "workflows[1].workflow_id"]]);
});

test("compiled digest changes with a semantic plan change and is deterministic for equivalent plans", () => {
  const first = compileDocumentContract(contract(), binding);
  const equivalent = compileDocumentContract(structuredClone(contract()), binding);
  const changed = contract(); changed.invariants[0].issue.message = "A different message.";
  assert.equal(first.compiledContractDigest, equivalent.compiledContractDigest);
  assert.notEqual(first.compiledContractDigest, compileDocumentContract(changed, binding).compiledContractDigest);
});

test("admission tokens bind generation and compiled plan digest exactly", () => {
  const compiled = compileDocumentContract(contract(), binding);
  const admitted = {
    state: { generation: 7, manifestDigest: "manifest-a" },
    contracts: [{ binding, loaded: { contractDigest: "a".repeat(64), version: 1, compiled } }],
  };
  const tokens = documentContractTokens(admitted);
  assert.equal(assertExactDocumentContractTokens(tokens, admitted).ok, true);
  for (const [field, value] of Object.entries({
    generation: 8,
    manifestDigest: "manifest-b",
    contractDigest: "b".repeat(64),
    compiledContractDigest: "b".repeat(64),
    version: 2,
  })) {
    assert.equal(assertExactDocumentContractTokens([{ ...tokens[0], [field]: value }], admitted).ok, false, `${field} must be exact`);
  }
  const snapshot = documentContractAdmissionSnapshot(admitted);
  assert.equal(verifyDocumentContractPostReplace({ admissionSnapshot: snapshot, resolution: admitted, root: { workflows: [{ workflow_id: "onboard", steps: [{ type: "message" }] }] } }).ok, true);
  const drifted = { ...admitted, state: { generation: 8, manifestDigest: "manifest-a" } };
  assert.equal(verifyDocumentContractPostReplace({ admissionSnapshot: snapshot, resolution: drifted, root: { workflows: [{ workflow_id: "onboard", steps: [{ type: "message" }] }] } }).code, "DOCUMENT_CONTRACT_CHANGED_DURING_SAVE");
  assert.equal(verifyDocumentContractPostReplace({ admissionSnapshot: null, resolution: admitted, root: { workflows: [{ workflow_id: "onboard", steps: [{ type: "message" }] }] } }).code, "DOCUMENT_CONTRACT_ADMISSION_SNAPSHOT_MISSING");
  assert.equal(verifyDocumentContractPostReplace({ admissionSnapshot: { generation: 7, manifestDigest: "manifest-a", contracts: [] }, resolution: admitted, root: { workflows: [{ workflow_id: "onboard", steps: [{ type: "message" }] }] } }).code, "DOCUMENT_CONTRACT_ADMISSION_SNAPSHOT_MISSING");
  assert.deepEqual(documentContractAdmissionSnapshot({ state: { generation: 0, manifestDigest: "" }, contracts: [] }).contracts, []);
  const noContracts = { state: { generation: 0, manifestDigest: "" }, contracts: [] };
  assert.equal(validateDocumentContractTokenSet(undefined, noContracts).ok, true);
  assert.equal(validateDocumentContractTokenSet([], noContracts).ok, true);
  assert.equal(validateDocumentContractTokenSet([{ contractId: "unexpected" }], noContracts).code, "DOCUMENT_CONTRACT_TOKEN_UNEXPECTED");
});

test("document-scope issue paths are root-relative and never duplicate the collection prefix", () => {
  const result = validateDocumentContractCandidate(resolution(), { workflows: [] });
  assert.deepEqual(result.issues.map(({ code, path }) => [code, path]), [["WORKFLOWS_REQUIRED", "workflows"]]);
});

test("candidate validation emits non-persistent derived outputs without changing the candidate", () => {
  const root = { workflows: [{ workflow_id: "onboard", steps: [{ type: "message" }, { type: "delay" }] }] };
  const before = structuredClone(root);
  assert.equal(validateDocumentContractCandidate(resolution(), root).ok, true);
  assert.deepEqual(evaluateDocumentContractDerivedOutputs(resolution(), root), [{ contractId: "workflow-shape", id: "step_count", path: "workflows[0]", value: 2, persistent: false }]);
  assert.deepEqual(root, before);
});

test("derived output evaluation rejects oversized collections before emitting partial output", () => {
  const root = { workflows: Array.from({ length: 1025 }, (_, index) => ({ workflow_id: String(index), steps: [] })) };
  assert.throws(
    () => evaluateDocumentContractDerivedOutputs(resolution(), root),
    (error) => error instanceof DocumentContractRuntimeError && error.code === "DOCUMENT_CONTRACT_DERIVED_OUTPUT_CARDINALITY_EXCEEDED",
  );
});

test("legacy contracts remain opaque until the stage 3 cutover", () => {
  assert.deepEqual(compileDocumentContract({ contract_version: 1, nodes: {} }, binding), { kind: "legacy", contractVersion: 1 });
});

test("path admission enumerates every document contract before candidate collection inspection", () => {
  const state = {
    status: "active",
    bindings: {
      nestedSchemas: [],
      identityPolicies: [],
      documentContracts: [
        { id: "workflow-governance", match: { dataSourceId: "data", path: "workflows.json", collection: "workflows" } },
        { id: "workflow-shape", match: { dataSourceId: "data", path: "workflows.json", collection: "workflows" } },
      ],
    },
  };
  assert.deepEqual(
    findCapabilityBindings(state, { engine: "document-contract-v1", dataSourceId: "data", path: "workflows.json" }).map((item) => item.id).sort(),
    ["workflow-governance", "workflow-shape"],
  );
});
