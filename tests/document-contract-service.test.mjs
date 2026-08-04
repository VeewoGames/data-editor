import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { loadDocumentContract } from "../src/document-contract-service.mjs";

const root = path.resolve("tests/fixtures/projects/contract-project");
const binding = { contract: "data/contracts/skill_nodes.json", contractSchema: "data/contracts/skill_nodes.schema.json" };

test("document-contract-v1 loader validates only declared contract resources", async () => {
  const loaded = await loadDocumentContract(root, binding);
  assert.equal(loaded.version, 1);
  assert.match(loaded.contractDigest, /^[a-f0-9]{64}$/);
  assert.match(loaded.etag, /^"[a-f0-9]{64}"$/);
});
