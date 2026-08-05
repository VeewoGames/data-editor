import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { loadDocumentContract } from "../src/document-contract-service.mjs";

const root = path.resolve("tests/fixtures/projects/workflow-contract-project");
const binding = {
  id: "workflow-shape",
  match: { dataSourceId: "data", path: "workflows.json", collection: "workflows" },
  contract: "data/contracts/workflow-shape.contract.json",
  contractSchema: ".data-editor/contracts/document-contract-v1.schema.json",
};

test("document-contract-v1 loader validates only declared contract resources", async () => {
  const loaded = await loadDocumentContract(root, binding);
  assert.equal(loaded.version, 1);
  assert.match(loaded.contractDigest, /^[a-f0-9]{64}$/);
	assert.match(loaded.etag, /^"[a-f0-9]{64}"$/);
	assert.equal(loaded.compiled.collection.path, "workflows");
});

test("document-contract-v1 loader compiles the engine-owned bounded grammar", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "document-contract-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await mkdir(path.join(temporaryRoot, "contracts"), { recursive: true });
  await writeFile(path.join(temporaryRoot, "contracts", "schema.json"), JSON.stringify({ type: "object" }));
  await writeFile(path.join(temporaryRoot, "contracts", "workflow.json"), JSON.stringify({
    contract_version: 1,
    grammar_version: 1,
    collections: [{ path: "workflows", entryKind: "array", allowMissing: false }],
    invariants: [{ id: "present", scope: "document", assert: { op: "nonEmptyArray", path: "workflows" }, issue: { code: "WORKFLOWS_REQUIRED", message: "Workflows are required." } }],
    derivedOutputs: [{ id: "step_count", scope: "entry", kind: "count", path: "steps" }],
    savePolicy: { requireExactTokenSet: true, validateCandidate: true, blockingIssues: true },
  }));
  const loaded = await loadDocumentContract(temporaryRoot, {
    id: "workflows",
    match: { dataSourceId: "data", path: "workflows.json", collection: "workflows" },
    contract: "contracts/workflow.json",
    contractSchema: "contracts/schema.json",
  });
  assert.equal(loaded.compiled.kind, "compiled");
  assert.equal(loaded.compiled.collection.path, "workflows");
  assert.match(loaded.compiled.compiledContractDigest, /^[a-f0-9]{64}$/);
});
