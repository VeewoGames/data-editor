import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { prepareCandidateCreate, validateCandidateCreateManifest } from "../src/entry-action-candidate-create.mjs";
import { commitEntryActionGroup, createCandidateCreateGroupJournalEntry } from "../src/entry-action-group-commit.mjs";
import { createEntryActionGroupJournal } from "../src/entry-action-group-journal.mjs";
import { createCommitJournal } from "../src/commit-journal.mjs";

const hash = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const documentText = `${JSON.stringify({ items: [{ id: 1, slug: "existing", name: "Existing", __entry_id: "01JEXISTING00000000000001" }] }, null, 2)}\n`;
const binding = {
  projectId: "fixture", runId: "10000000-0000-4000-8000-000000000001", actionId: "create-item",
  sourcePath: "data/items.json", collectionPath: "items", canonicalFileKey: "a".repeat(64),
  baseDocumentEtag: `"${hash(documentText)}"`, ruleDigest: "b".repeat(64), fencingToken: 2,
  createContractId: "fixture.item-create.v1", createContractDigest: "c".repeat(64),
};
const contract = {
  contractId: binding.createContractId, digest: binding.createContractDigest, collectionKind: "array",
  rowSchema: { type: "object", additionalProperties: false, required: ["slug", "name", "id", "status", "dev_note", "__entry_id"], properties: { slug: { type: "string", minLength: 1, pattern: "^[a-z][a-z0-9_-]*$" }, name: { type: "string", minLength: 1, maxLength: 64 }, tags: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: { type: "string", minLength: 1 } }, input_tags: { type: "array", maxItems: 4, uniqueItems: true, items: { type: "string" } }, output_tags: { type: "array", maxItems: 4, uniqueItems: true, items: { type: "string" } }, metadata: { type: "object", additionalProperties: false, required: ["weight"], properties: { weight: { type: "number", minimum: 0, maximum: 10 }, note: { type: "string", nullable: true, maxLength: 16 } } }, status: { type: "string", const: "draft" }, id: { type: "integer", minimum: 1 }, dev_note: { type: "string" }, __entry_id: { type: "string", pattern: "^[0-9A-Z]{26}$" } } },
  requiredFields: ["slug", "name"], writableFields: ["slug", "name", "tags", "input_tags", "output_tags", "metadata"], serverOwnedFields: ["id", "status"],
  serverDefaults: { status: "draft" }, uniqueKeys: [["slug"], ["id"]], humanNoteFields: ["dev_note"], humanNoteDefaults: { dev_note: "" },
  textArtifactPolicy: { required: true, maxBytes: 4096 },
};
const content = "# Candidate\n";
const manifest = {
  version: 1, kind: "candidate-create", candidateId: "candidate_alpha", designSubjectDigest: "d".repeat(64),
  row: { slug: "alpha", name: "Alpha", tags: ["attack"], input_tags: ["melee"], output_tags: ["damage"], metadata: { weight: 2, note: null } }, textArtifact: { afterContent: content, afterDigest: hash(content) }, summary: "Create Alpha",
};

test("candidate manifest is exact and rejects server or human-note fields", () => {
  assert.deepEqual(validateCandidateCreateManifest(manifest), manifest);
  assert.throws(() => validateCandidateCreateManifest({ ...manifest, runId: binding.runId }), { code: "CANDIDATE_CREATE_MANIFEST_INVALID" });
  assert.throws(() => validateCandidateCreateManifest({ ...manifest, row: { ...manifest.row, __entry_id: "forged" } }), { code: "CANDIDATE_CREATE_SERVER_FIELD_FORBIDDEN" });
});

test("candidate prepare allocates server identity and binds human notes verbatim", async () => {
  const note = "Designer text, unchanged.";
  let allocationRequest;
  const prepared = await prepareCandidateCreate({
    manifest, binding, createContract: contract, documentText,
    humanNotes: { field: "dev_note", text: note, digest: hash(note) },
    allocateServerFields: async (request) => { allocationRequest = request; return { id: 2 }; },
    resolveTextArtifact: async ({ row }) => ({ id: "artifact_fixture", path: `docs/${row.slug}.md`, beforeExists: false, beforeDigest: null, afterContent: content, afterDigest: hash(content) }),
  });
  assert.equal(prepared.row.id, 2);
  assert.deepEqual(allocationRequest.fields, ["id"]);
  assert.equal(prepared.row.dev_note, note);
  assert.match(prepared.row.__entry_id, /^[0-9A-Z]{26}$/);
  assert.equal(JSON.parse(prepared.sourceAfterContent).items.length, 2);
  assert.match(prepared.idempotencyKey, /^candidate_create_[0-9a-f]{64}$/);
});

test("candidate text artifact path and persisted path field share one derivation", async () => {
  const pathContract = structuredClone(contract); pathContract.serverOwnedFields.push("dev_doc"); pathContract.rowSchema.required.push("dev_doc"); pathContract.rowSchema.properties.dev_doc = { type: "string", const: "docs/alpha.md" }; pathContract.textArtifactPolicy = { required: true, maxBytes: 4096, pathTemplate: "docs/{key}.md", pathKeyField: "slug", textArtifactPathField: "dev_doc" };
  const prepared = await prepareCandidateCreate({ manifest, binding, createContract: pathContract, documentText, allocateServerFields: async ({ fields }) => { assert.deepEqual(fields, ["id"]); return { id: 2 }; }, resolveTextArtifact: async ({ derivedTextArtifactPath }) => ({ id: "artifact_fixture", path: derivedTextArtifactPath, beforeExists: false, beforeDigest: null, afterContent: content, afterDigest: hash(content) }) });
  assert.equal(prepared.row.dev_doc, "docs/alpha.md"); assert.equal(prepared.textArtifact.path, prepared.row.dev_doc);
  const drifted = structuredClone(pathContract); drifted.serverDefaults.dev_doc = "docs/drift.md";
  await assert.rejects(() => prepareCandidateCreate({ manifest, binding, createContract: drifted, documentText, allocateServerFields: async () => ({ id: 2 }), resolveTextArtifact: async () => null }), { code: "CANDIDATE_CREATE_TEXT_ARTIFACT_PATH_MISMATCH" });
  await assert.rejects(() => prepareCandidateCreate({ manifest, binding, createContract: pathContract, documentText, allocateServerFields: async () => ({ id: 2 }), resolveTextArtifact: async () => ({ id: "artifact_fixture", path: "docs/other.md", beforeExists: false, beforeDigest: null, afterContent: content, afterDigest: hash(content) }) }), { code: "CANDIDATE_CREATE_TEXT_ARTIFACT_INVALID" });
});

test("candidate prepare fails closed when a project-owned field has no allocator", async () => {
  await assert.rejects(() => prepareCandidateCreate({
    manifest, binding, createContract: contract, documentText,
    resolveTextArtifact: async () => ({ id: "artifact_fixture", path: "docs/alpha.md", beforeExists: false, beforeDigest: null, afterContent: content, afterDigest: hash(content) }),
  }), { code: "CANDIDATE_CREATE_SERVER_ALLOCATION_UNAVAILABLE" });
});

test("a project allocator can assign a non-numeric server-owned field", async () => {
  const codeContract = structuredClone(contract);
  codeContract.serverOwnedFields = ["code", "status"];
  codeContract.uniqueKeys = [["slug"], ["code"]];
  codeContract.rowSchema.required = codeContract.rowSchema.required.map((field) => field === "id" ? "code" : field);
  delete codeContract.rowSchema.properties.id;
  codeContract.rowSchema.properties.code = { type: "string", pattern: "^ITEM-[A-Z]+$" };
  const prepared = await prepareCandidateCreate({
    manifest, binding, createContract: codeContract, documentText,
    allocateServerFields: async ({ fields }) => { assert.deepEqual(fields, ["code"]); return { code: "ITEM-ALPHA" }; },
    resolveTextArtifact: async () => ({ id: "artifact_fixture", path: "docs/alpha.md", beforeExists: false, beforeDigest: null, afterContent: content, afterDigest: hash(content) }),
  });
  assert.equal(prepared.row.code, "ITEM-ALPHA");
});

test("a project allocator receives an empty collection without generic guesses", async () => {
  const emptyText = `${JSON.stringify({ items: [] }, null, 2)}\n`;
  let rowsSeen;
  const prepared = await prepareCandidateCreate({
    manifest,
    binding: { ...binding, baseDocumentEtag: `"${hash(emptyText)}"` },
    createContract: contract,
    documentText: emptyText,
    allocateServerFields: async ({ fields, rows }) => { rowsSeen = rows; assert.deepEqual(fields, ["id"]); return { id: 41 }; },
    resolveTextArtifact: async () => ({ id: "artifact_fixture", path: "docs/alpha.md", beforeExists: false, beforeDigest: null, afterContent: content, afterDigest: hash(content) }),
  });
  assert.deepEqual(rowsSeen, []);
  assert.equal(prepared.row.id, 41);
});

test("candidate prepare defaults absent human notes and rejects forged or duplicate business values", async () => {
  const args = { manifest, binding, createContract: contract, documentText, allocateServerFields: async () => ({ id: 2 }), resolveTextArtifact: async () => ({ id: "artifact_fixture", path: "docs/alpha.md", beforeExists: false, beforeDigest: null, afterContent: content, afterDigest: hash(content) }) };
  const prepared = await prepareCandidateCreate(args);
  assert.equal(prepared.row.dev_note, "");
  await assert.rejects(() => prepareCandidateCreate({ ...args, manifest: { ...manifest, row: { ...manifest.row, dev_note: "forged" } } }), { code: "CANDIDATE_CREATE_FIELD_FORBIDDEN" });
  await assert.rejects(() => prepareCandidateCreate({ ...args, manifest: { ...manifest, row: { ...manifest.row, slug: "existing" } } }), { code: "CANDIDATE_CREATE_UNIQUE_CONFLICT" });
  await assert.rejects(() => prepareCandidateCreate({ ...args, allocateServerFields: async () => ({ id: "not-an-integer" }) }), { code: "CANDIDATE_CREATE_SCHEMA_INVALID" });
});

test("candidate request semantic identity is stable across server id allocation", async () => {
  const base = { manifest, binding, createContract: contract, documentText, resolveTextArtifact: async () => ({ id: "artifact_fixture", path: "docs/alpha.md", beforeExists: false, beforeDigest: null, afterContent: content, afterDigest: hash(content) }) };
  const first = await prepareCandidateCreate({ ...base, allocateServerFields: async () => ({ id: 2 }) });
  const replay = await prepareCandidateCreate({ ...base, allocateServerFields: async () => ({ id: 99 }) });
  assert.equal(first.idempotencyKey, replay.idempotencyKey);
  assert.equal(first.semanticDigest, replay.semanticDigest);
  assert.notEqual(first.row.id, replay.row.id);
});

test("candidate row schema recursively rejects tags, nested data, unknown keywords and injected values", async () => {
  const base = { manifest, binding, createContract: contract, documentText, allocateServerFields: async () => ({ id: 2 }), resolveTextArtifact: async () => ({ id: "artifact_fixture", path: "docs/alpha.md", beforeExists: false, beforeDigest: null, afterContent: content, afterDigest: hash(content) }) };
  await assert.rejects(() => prepareCandidateCreate({ ...base, manifest: { ...manifest, row: { ...manifest.row, tags: ["attack", "attack"] } } }), { code: "CANDIDATE_CREATE_SCHEMA_INVALID" });
  await assert.rejects(() => prepareCandidateCreate({ ...base, manifest: { ...manifest, row: { ...manifest.row, metadata: { weight: 11 } } } }), { code: "CANDIDATE_CREATE_SCHEMA_INVALID" });
  await assert.rejects(() => prepareCandidateCreate({ ...base, createContract: { ...contract, rowSchema: { ...contract.rowSchema, unsupportedKeyword: true } } }), { code: "CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID" });
  await assert.rejects(() => prepareCandidateCreate({ ...base, createContract: { ...contract, serverDefaults: { status: "invalid" } } }), { code: "CANDIDATE_CREATE_SCHEMA_INVALID" });
  await assert.rejects(() => prepareCandidateCreate({ ...base, createContract: { ...contract, rowSchema: { ...contract.rowSchema, properties: { ...contract.rowSchema.properties, dev_note: { type: "string", maxLength: 3 } } } }, humanNotes: { field: "dev_note", text: "too long", digest: hash("too long") } }), { code: "CANDIDATE_CREATE_SCHEMA_INVALID" });
});

test("candidate group entry reuses the existing durable group protocol", async (t) => {
  const prepared = await prepareCandidateCreate({ manifest, binding, createContract: contract, documentText, allocateServerFields: async () => ({ id: 2 }), resolveTextArtifact: async () => ({ id: "artifact_fixture", path: "docs/alpha.md", beforeExists: false, beforeDigest: null, afterContent: content, afterDigest: hash(content) }) });
  const lease = { canonicalFileKey: binding.canonicalFileKey, runId: binding.runId, ownerToken: "owner", ownerHash: "e".repeat(64), fencingToken: 2, jobInstanceId: "job" };
  const entry = createCandidateCreateGroupJournalEntry({ prepared, lease, documentText, sourceIdentity: { canonicalFileKey: binding.canonicalFileKey }, artifactIdentity: { canonicalFileKey: "f".repeat(64) } });
  assert.equal(entry.operation, "candidate_create");
  assert.equal(entry.source.childEntry.saveType, "candidate_create_commit");
  assert.equal(entry.candidateId, manifest.candidateId);
  assert.equal(entry.manifest.row.dev_note, undefined);
  const root = await mkdtemp(path.join(os.tmpdir(), "candidate-group-journal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const persisted = await createEntryActionGroupJournal({ directory: root }).begin(entry);
  assert.equal(persisted.operation, "candidate_create");
});

test("candidate group commit writes both targets and replays without reallocating identity", async (t) => {
  const prepared = await prepareCandidateCreate({ manifest, binding, createContract: contract, documentText, allocateServerFields: async () => ({ id: 2 }), resolveTextArtifact: async () => ({ id: "artifact_fixture", path: "docs/alpha.md", beforeExists: false, beforeDigest: null, afterContent: content, afterDigest: hash(content) }) });
  const lease = { canonicalFileKey: binding.canonicalFileKey, runId: binding.runId, ownerToken: "owner", ownerHash: "e".repeat(64), fencingToken: 2, jobInstanceId: "job" };
  const sourceIdentity = { canonicalFileKey: binding.canonicalFileKey }; const artifactIdentity = { canonicalFileKey: "f".repeat(64) };
  const entry = createCandidateCreateGroupJournalEntry({ prepared, lease, documentText, sourceIdentity, artifactIdentity });
  const root = await mkdtemp(path.join(os.tmpdir(), "candidate-group-commit-")); t.after(() => rm(root, { recursive: true, force: true }));
  let source = documentText; let artifact = null; let published = 0;
  const input = {
    coordinator: { withIdentities: async (_identities, task) => task() },
    groupJournal: createEntryActionGroupJournal({ directory: path.join(root, "group") }), childJournal: createCommitJournal({ directory: path.join(root, "child") }),
    groupEntry: entry, sourceIdentity, artifactIdentity,
    readSource: async () => source, writeSource: async (value) => { source = value; }, readArtifact: async () => artifact, writeArtifact: async (value) => { artifact = value; },
    verifyOwnership: async () => {}, verifyAuthority: async (value) => { assert.equal(value.createContractDigest, contract.digest); },
    refreshIdentities: async () => ({ source: sourceIdentity, artifact: artifactIdentity }), publishResultIdempotently: async () => { published += 1; },
  };
  await commitEntryActionGroup(input);
  assert.equal(JSON.parse(source).items[1].__entry_id, prepared.rowId);
  assert.equal(artifact, content);
  assert.equal(published, 1);
  await commitEntryActionGroup(input);
  assert.equal(JSON.parse(source).items[1].__entry_id, prepared.rowId);
  assert.equal(published, 1);
});

test("candidate-create resumes forward from every durable group interruption", async (t) => {
  const prepared = await prepareCandidateCreate({ manifest, binding, createContract: contract, documentText, allocateServerFields: async () => ({ id: 2 }), resolveTextArtifact: async () => ({ id: "artifact_fixture", path: "docs/alpha.md", beforeExists: false, beforeDigest: null, afterContent: content, afterDigest: hash(content) }) });
  const lease = { canonicalFileKey: binding.canonicalFileKey, runId: binding.runId, ownerToken: "owner", ownerHash: "e".repeat(64), fencingToken: 2, jobInstanceId: "job" };
  const sourceIdentity = { canonicalFileKey: binding.canonicalFileKey }; const artifactIdentity = { canonicalFileKey: "f".repeat(64) };
  for (const failure of ["artifact", "source", "publish"]) {
    const root = await mkdtemp(path.join(os.tmpdir(), `candidate-recovery-${failure}-`)); t.after(() => rm(root, { recursive: true, force: true }));
    const entry = createCandidateCreateGroupJournalEntry({ prepared, lease, documentText, sourceIdentity, artifactIdentity });
    let source = documentText; let artifact = null; let published = 0; let failOnce = true;
    const input = {
      coordinator: { withIdentities: async (_identities, task) => task() }, groupJournal: createEntryActionGroupJournal({ directory: path.join(root, "group") }), childJournal: createCommitJournal({ directory: path.join(root, "child") }),
      groupEntry: entry, sourceIdentity, artifactIdentity, readSource: async () => source, readArtifact: async () => artifact,
      writeArtifact: async (value) => { if (failure === "artifact" && failOnce) { failOnce = false; throw new Error("artifact crash"); } artifact = value; },
      writeSource: async (value) => { if (failure === "source" && failOnce) { failOnce = false; throw new Error("source crash"); } source = value; },
      verifyOwnership: async () => {}, verifyAuthority: async () => {}, refreshIdentities: async () => ({ source: sourceIdentity, artifact: artifactIdentity }),
      publishResultIdempotently: async () => { if (failure === "publish" && failOnce) { failOnce = false; throw new Error("publish crash"); } published += 1; },
    };
    await assert.rejects(() => commitEntryActionGroup(input));
    const recovered = await commitEntryActionGroup(input);
    assert.equal(recovered.stage, "result_published"); assert.equal(JSON.parse(source).items[1].__entry_id, prepared.rowId); assert.equal(artifact, content); assert.equal(published, 1);
  }
});
