import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createDocumentCommitCoordinator } from "../src/document-commit-coordinator.mjs";
import { promoteEmbeddedIdentity, recoverPendingEmbeddedIdentityPromotions } from "../src/durable-identity-coordinator.mjs";
import { createIdentityPromotionJournal } from "../src/identity-promotion-journal.mjs";
import { createIdentityPromotionIntent } from "../src/identity-promotion-journal.mjs";
import { rowDigest } from "../src/row-digest.mjs";

test("embedded promotion writes one canonical durable id and replays the receipt without a second write", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-promotion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = path.join(root, "data"); await mkdir(data);
  const file = path.join(data, "items.json"); await writeFile(file, JSON.stringify({ items: [{ item_id: "potion" }] }, null, 2));
  const context = { projectRoot: root, projectId: "fixture", runtimeDir: ".data-editor/runtime", dataSources: [{ id: "data", kind: "project", path: "data" }], filePolicy: { includeExtensions: [".json"] } };
  const state = { status: "active", generation: 3, manifestDigest: "manifest", bindings: { identityPolicies: [{ id: "items", match: { dataSourceId: "data", path: "items.json", collection: "items" }, provider: { kind: "embedded-v1", field: "__entry_id" } }] } };
  const journal = createIdentityPromotionJournal({ directory: path.join(root, ".journal") });
  const input = { projectContext: context, capabilityState: state, sourcePath: "data/items.json", collectionPath: "items", sourceRowIndex: 0, expectedRowDigest: rowDigest({ item_id: "potion" }), idempotencyKey: "promotion_123", documentCommitCoordinator: createDocumentCommitCoordinator(), dependencies: { journal } };
  const first = await promoteEmbeddedIdentity(input);
  assert.equal(first.replayed, false);
  assert.ok(first.receipt.durableId);
  const afterFirst = await readFile(file, "utf8");
  const replay = await promoteEmbeddedIdentity(input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.durableId, first.receipt.durableId);
  assert.equal(await readFile(file, "utf8"), afterFirst);
});

test("embedded promotion fails closed before any write when canonical row digest is stale", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-promotion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = path.join(root, "data"); await mkdir(data);
  const file = path.join(data, "items.json"); const original = JSON.stringify({ items: [{ item_id: "potion" }] }, null, 2); await writeFile(file, original);
  const context = { projectRoot: root, projectId: "fixture", runtimeDir: ".data-editor/runtime", dataSources: [{ id: "data", kind: "project", path: "data" }], filePolicy: { includeExtensions: [".json"] } };
  const state = { status: "active", generation: 3, manifestDigest: "manifest", bindings: { identityPolicies: [{ id: "items", match: { dataSourceId: "data", path: "items.json", collection: "items" }, provider: { kind: "embedded-v1", field: "__entry_id" } }] } };
  await assert.rejects(() => promoteEmbeddedIdentity({ projectContext: context, capabilityState: state, sourcePath: "data/items.json", collectionPath: "items", sourceRowIndex: 0, expectedRowDigest: "stale", idempotencyKey: "promotion_456", documentCommitCoordinator: createDocumentCommitCoordinator() }), { code: "IDENTITY_PROMOTION_TARGET_STALE" });
  assert.equal(await readFile(file, "utf8"), original);
});

test("recovery publishes the original durable id when replacement preceded receipt publication", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-promotion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = path.join(root, "data"); await mkdir(data);
  const file = path.join(data, "items.json"); await writeFile(file, JSON.stringify({ items: [{ item_id: "potion", __entry_id: "DURABLE-RECOVERED" }] }, null, 2));
  const context = { projectRoot: root, projectId: "fixture", runtimeDir: ".data-editor/runtime", dataSources: [{ id: "data", kind: "project", path: "data" }], filePolicy: { includeExtensions: [".json"] } };
  const state = { status: "active", generation: 3, manifestDigest: "manifest", bindings: { identityPolicies: [{ id: "items", match: { dataSourceId: "data", path: "items.json", collection: "items" }, provider: { kind: "embedded-v1", field: "__entry_id" } }] } };
  const journal = createIdentityPromotionJournal({ directory: path.join(root, ".journal") });
  await journal.write(createIdentityPromotionIntent({ idempotencyKey: "promotion_789", durableId: "DURABLE-RECOVERED", capabilityGeneration: 3, manifestDigest: "manifest" }));
  const recovered = await promoteEmbeddedIdentity({ projectContext: context, capabilityState: state, sourcePath: "data/items.json", collectionPath: "items", sourceRowIndex: 0, expectedRowDigest: rowDigest({ item_id: "potion" }), idempotencyKey: "promotion_789", documentCommitCoordinator: createDocumentCommitCoordinator(), dependencies: { journal } });
  assert.equal(recovered.replayed, true);
  assert.equal(recovered.receipt.durableId, "DURABLE-RECOVERED");
  assert.equal((await journal.read("promotion_789")).stage, "receipt");
});

test("startup recovery scans durable journals without creating identities for uncommitted intents", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-promotion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = path.join(root, "data"); await mkdir(data);
  await writeFile(path.join(data, "items.json"), JSON.stringify({ items: [{ item_id: "potion" }] }, null, 2));
  const context = { projectRoot: root, projectId: "fixture", runtimeDir: ".data-editor/runtime", dataSources: [{ id: "data", kind: "project", path: "data" }], filePolicy: { includeExtensions: [".json"] } };
  const state = { status: "active", generation: 3, manifestDigest: "manifest", bindings: { identityPolicies: [{ id: "items", match: { dataSourceId: "data", path: "items.json", collection: "items" }, provider: { kind: "embedded-v1", field: "__entry_id" } }] } };
  const journal = createIdentityPromotionJournal({ directory: path.join(root, ".journal") });
  await journal.write(createIdentityPromotionIntent({ idempotencyKey: "promotion_901", projectId: "fixture", sourcePath: "data/items.json", collectionPath: "items", durableId: "DURABLE-NOT-WRITTEN" }));
  const result = await recoverPendingEmbeddedIdentityPromotions({ projectContext: context, capabilityState: state, dependencies: { journal } });
  assert.deepEqual(result, { recovered: [], pending: ["promotion_901"] });
  assert.equal(JSON.parse(await readFile(path.join(data, "items.json"), "utf8")).items[0].__entry_id, undefined);
});

test("promotion journals the admission snapshot and keeps recovery evidence when post-replace verification drifts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-promotion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = path.join(root, "data"); await mkdir(data);
  await writeFile(path.join(data, "items.json"), JSON.stringify({ items: [{ item_id: "potion" }] }, null, 2));
  const context = { projectRoot: root, projectId: "fixture", runtimeDir: ".data-editor/runtime", dataSources: [{ id: "data", kind: "project", path: "data" }], filePolicy: { includeExtensions: [".json"] } };
  const state = { status: "active", generation: 3, manifestDigest: "manifest", bindings: {
    identityPolicies: [{ id: "items", match: { dataSourceId: "data", path: "items.json", collection: "items" }, provider: { kind: "embedded-v1", field: "__entry_id" } }],
    documentContracts: [{ id: "items-shape", match: { dataSourceId: "data", path: "items.json", collection: "items" } }],
  } };
  const journal = createIdentityPromotionJournal({ directory: path.join(root, ".journal") });
  const snapshot = { generation: 3, manifestDigest: "manifest", contracts: [{ contractId: "items-shape", compiledContractDigest: "a".repeat(64) }] };
  let verifierCalls = 0;
  await assert.rejects(() => promoteEmbeddedIdentity({
    projectContext: context, capabilityState: state, sourcePath: "data/items.json", collectionPath: "items", sourceRowIndex: 0,
    expectedRowDigest: rowDigest({ item_id: "potion" }), idempotencyKey: "promotion_999", documentCommitCoordinator: createDocumentCommitCoordinator(),
    validateCandidate: async () => snapshot,
    verifyPostReplaceCandidate: async ({ admissionSnapshot }) => { assert.deepEqual(admissionSnapshot, snapshot); verifierCalls += 1; if (verifierCalls > 1) throw Object.assign(new Error("drift"), { code: "DOCUMENT_CONTRACT_CHANGED_DURING_SAVE" }); },
    dependencies: { journal },
  }), { code: "DOCUMENT_CONTRACT_CHANGED_DURING_SAVE" });
  const pending = await journal.read("promotion_999");
  assert.equal(pending.stage, "intent");
  assert.equal(pending.recovery_pending, true);
  assert.deepEqual(pending.contractAdmission, snapshot);
});

test("contract-bound intent retry verifies its persisted snapshot before the durable-id writer", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-promotion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = path.join(root, "data"); await mkdir(data);
  const file = path.join(data, "items.json"); const before = JSON.stringify({ items: [{ item_id: "potion" }] }, null, 2); await writeFile(file, before);
  const context = { projectRoot: root, projectId: "fixture", runtimeDir: ".data-editor/runtime", dataSources: [{ id: "data", kind: "project", path: "data" }], filePolicy: { includeExtensions: [".json"] } };
  const state = { status: "active", generation: 3, manifestDigest: "manifest", bindings: {
    identityPolicies: [{ id: "items", match: { dataSourceId: "data", path: "items.json", collection: "items" }, provider: { kind: "embedded-v1", field: "__entry_id" } }],
    documentContracts: [{ id: "items-shape", match: { dataSourceId: "data", path: "items.json", collection: "items" } }],
  } };
  const journal = createIdentityPromotionJournal({ directory: path.join(root, ".journal") });
  await journal.write(createIdentityPromotionIntent({ idempotencyKey: "promotion_654", projectId: "fixture", sourcePath: "data/items.json", collectionPath: "items", sourceRowIndex: 0, expectedRowDigest: rowDigest({ item_id: "potion" }), durableId: "DURABLE-RETRY", capabilityGeneration: 3, manifestDigest: "manifest", contractAdmission: { generation: 3, manifestDigest: "manifest", contracts: [{ contractId: "items-shape" }] } }));
  let writes = 0;
  await assert.rejects(() => promoteEmbeddedIdentity({
    projectContext: context, capabilityState: state, sourcePath: "data/items.json", collectionPath: "items", sourceRowIndex: 0,
    expectedRowDigest: rowDigest({ item_id: "potion" }), idempotencyKey: "promotion_654", documentCommitCoordinator: createDocumentCommitCoordinator(),
    validateCandidate: async () => { throw new Error("retry must preserve persisted admission"); },
    verifyPostReplaceCandidate: async () => { throw Object.assign(new Error("drift"), { code: "DOCUMENT_CONTRACT_CHANGED_DURING_SAVE" }); },
    dependencies: { journal, writeText: async () => { writes += 1; } },
  }), { code: "DOCUMENT_CONTRACT_CHANGED_DURING_SAVE" });
  assert.equal(writes, 0);
  assert.equal(await readFile(file, "utf8"), before);
  assert.equal((await journal.read("promotion_654")).stage, "intent");
});

test("contract-bound promotion refuses a recovered intent without an admission snapshot or receipt", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-promotion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = path.join(root, "data"); await mkdir(data);
  await writeFile(path.join(data, "items.json"), JSON.stringify({ items: [{ item_id: "potion", __entry_id: "DURABLE-PENDING" }] }, null, 2));
  const context = { projectRoot: root, projectId: "fixture", runtimeDir: ".data-editor/runtime", dataSources: [{ id: "data", kind: "project", path: "data" }], filePolicy: { includeExtensions: [".json"] } };
  const state = { status: "active", generation: 3, manifestDigest: "manifest", bindings: {
    identityPolicies: [{ id: "items", match: { dataSourceId: "data", path: "items.json", collection: "items" }, provider: { kind: "embedded-v1", field: "__entry_id" } }],
    documentContracts: [{ id: "items-shape", match: { dataSourceId: "data", path: "items.json", collection: "items" } }],
  } };
  const journal = createIdentityPromotionJournal({ directory: path.join(root, ".journal") });
  await journal.write(createIdentityPromotionIntent({ idempotencyKey: "promotion_987", projectId: "fixture", sourcePath: "data/items.json", collectionPath: "items", durableId: "DURABLE-PENDING", capabilityGeneration: 3, manifestDigest: "manifest" }));
  await assert.rejects(() => promoteEmbeddedIdentity({
    projectContext: context, capabilityState: state, sourcePath: "data/items.json", collectionPath: "items", sourceRowIndex: 0,
    expectedRowDigest: rowDigest({ item_id: "potion", __entry_id: "DURABLE-PENDING" }), idempotencyKey: "promotion_987", documentCommitCoordinator: createDocumentCommitCoordinator(),
    validateCandidate: async () => ({ generation: 3, manifestDigest: "manifest", contracts: [{ contractId: "items-shape" }] }),
    verifyPostReplaceCandidate: async () => { throw new Error("must not verify missing admission"); },
    dependencies: { journal },
  }), { code: "DOCUMENT_CONTRACT_ADMISSION_SNAPSHOT_MISSING" });
  const pending = await journal.read("promotion_987");
  assert.equal(pending.stage, "intent");
  assert.equal(pending.recovery_pending, true);
  assert.equal(pending.receipt, undefined);
});
