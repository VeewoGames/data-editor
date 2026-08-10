import crypto from "node:crypto";
import { buildDocumentModel, getRows, addRow } from "./document-model.mjs";
import { ensurePersistentEntryId, persistentEntryIdField } from "./model/persistent-entry-id.mjs";
import { serializeJson } from "./json-codec.mjs";
import { assertCandidateRowSchema } from "./entry-action-candidate-row-schema.mjs";
import { deriveTextArtifactPath } from "./entry-action-text-artifact-path.mjs";

const DIGEST = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const FIELDS = ["version", "kind", "candidateId", "designSubjectDigest", "row", "textArtifact", "summary"];
const ARTIFACT_FIELDS = ["afterContent", "afterDigest"];

export function validateCandidateCreateManifest(value) {
  exact(value, FIELDS, "candidate-create manifest");
  if (value.version !== 1 || value.kind !== "candidate-create") invalid("candidate-create identity is invalid");
  requiredSafe(value.candidateId, "candidateId");
  if (!DIGEST.test(value.designSubjectDigest)) invalid("designSubjectDigest is invalid");
  if (!isPlainObject(value.row)) invalid("candidate row must be an object");
  if (Object.hasOwn(value.row, persistentEntryIdField)) invalid("candidate row contains a server-owned identity", "CANDIDATE_CREATE_SERVER_FIELD_FORBIDDEN");
  if (value.textArtifact !== null) {
    exact(value.textArtifact, ARTIFACT_FIELDS, "candidate textArtifact");
    if (typeof value.textArtifact.afterContent !== "string" || !value.textArtifact.afterContent.length) invalid("candidate textArtifact content is invalid");
    if (!DIGEST.test(value.textArtifact.afterDigest) || digest(value.textArtifact.afterContent) !== value.textArtifact.afterDigest) invalid("candidate textArtifact digest is invalid");
  }
  if (typeof value.summary !== "string" || !value.summary.trim()) invalid("candidate summary is required");
  return structuredClone(value);
}

export function candidateCreateRequestIdentity({ manifest, projectId, actionId, sourcePath, collectionPath, humanNotes = null, createContractDigest }) {
  const value = validateCandidateCreateManifest(manifest);
  const semanticDigest = digest(canonicalJson({ manifest: value, humanNotes: humanNotes == null ? null : humanNotes, createContractDigest }));
  const idempotencyKey = `candidate_create_${digest(`${projectId}\u0000${actionId}\u0000${sourcePath}\u0000${collectionPath}\u0000${value.candidateId}`)}`;
  return { candidateId: value.candidateId, semanticDigest, idempotencyKey };
}

export async function prepareCandidateCreate({
  manifest,
  binding,
  createContract,
  documentText,
  humanNotes = null,
  allocateServerFields = null,
  resolveTextArtifact = async () => null,
  persistentEntryId = null,
}) {
  const value = validateCandidateCreateManifest(manifest);
  assertBinding(binding);
  assertCreateContract(createContract, binding);
  if (etag(documentText) !== binding.baseDocumentEtag) fail("CANDIDATE_CREATE_DOCUMENT_STALE");
  const source = JSON.parse(documentText);
  const model = buildDocumentModel(source, "json", binding.sourcePath);
  if (model.rootCollectionKind === "record-map" || !model.collections.some((item) => item.path === binding.collectionPath)) fail("CANDIDATE_CREATE_COLLECTION_UNSUPPORTED");
  const rows = getRows(model, binding.collectionPath);
  const row = structuredClone(value.row);
  const writable = new Set(createContract.writableFields);
  const serverOwned = new Set(createContract.serverOwnedFields);
  const humanNoteFields = new Set(createContract.humanNoteFields ?? []);
  for (const field of Object.keys(row)) {
    if (!writable.has(field) || serverOwned.has(field) || humanNoteFields.has(field)) fail("CANDIDATE_CREATE_FIELD_FORBIDDEN");
  }
  for (const field of createContract.requiredFields) if (!Object.hasOwn(row, field)) fail("CANDIDATE_CREATE_REQUIRED_FIELD_MISSING");
  assertRowSchema(row, createContract.rowSchema, { requireAll: false });
  assertUniqueKeys(rows, row, createContract.uniqueKeys, true);
  for (const [field, defaultValue] of Object.entries(createContract.serverDefaults ?? {})) row[field] = structuredClone(defaultValue);
  const derivedArtifactPath = value.textArtifact === null || !createContract.textArtifactPolicy?.pathTemplate ? null : deriveTextArtifactPath(createContract.textArtifactPolicy, row);
  const artifactPathField = createContract.textArtifactPolicy?.textArtifactPathField ?? null;
  if (artifactPathField) {
    if (!serverOwned.has(artifactPathField) || (Object.hasOwn(row, artifactPathField) && row[artifactPathField] !== derivedArtifactPath)) fail("CANDIDATE_CREATE_TEXT_ARTIFACT_PATH_MISMATCH");
    row[artifactPathField] = derivedArtifactPath;
  }
  const allocationFields = createContract.serverOwnedFields.filter((field) => !Object.hasOwn(row, field));
  if (allocationFields.length) {
    if (typeof allocateServerFields !== "function") fail("CANDIDATE_CREATE_SERVER_ALLOCATION_UNAVAILABLE");
    const allocated = await allocateServerFields({ fields: [...allocationFields], rows: structuredClone(rows), row: structuredClone(row), contract: structuredClone(createContract) });
    if (!isPlainObject(allocated) || Object.keys(allocated).length !== allocationFields.length
      || Object.keys(allocated).some((field) => !allocationFields.includes(field))
      || allocationFields.some((field) => !Object.hasOwn(allocated, field))) fail("CANDIDATE_CREATE_SERVER_ALLOCATION_INVALID");
    Object.assign(row, allocated);
  }
  bindHumanNotes(row, humanNotes, humanNoteFields, createContract.humanNoteDefaults ?? {});
  if (Object.hasOwn(row, persistentEntryIdField)) fail("CANDIDATE_CREATE_SERVER_ALLOCATION_INVALID");
  if (persistentEntryId !== null) row[persistentEntryIdField] = persistentEntryId;
  const identity = ensurePersistentEntryId(row);
  if ((!identity.changed && persistentEntryId === null) || !identity.value || (persistentEntryId !== null && identity.value !== persistentEntryId)) fail("CANDIDATE_CREATE_IDENTITY_ALLOCATION_FAILED");
  assertUniqueKeys(rows, row, createContract.uniqueKeys);
  // Server defaults, human notes and durable identity are part of the persisted
  // row. Validate that final shape, not merely the model-owned fragment.
  assertRowSchema(row, createContract.rowSchema);
  addRow(model, binding.collectionPath, row);
  const artifact = await resolveTextArtifact({ manifest: value, row: structuredClone(row), contract: structuredClone(createContract), derivedTextArtifactPath: derivedArtifactPath });
  if (createContract.textArtifactPolicy?.required && !artifact) fail("CANDIDATE_CREATE_TEXT_ARTIFACT_REQUIRED");
  if (artifact) assertPreparedArtifact(artifact, value.textArtifact, createContract.textArtifactPolicy, derivedArtifactPath);
  const afterText = serializeJson(model.root);
  const { semanticDigest, idempotencyKey } = candidateCreateRequestIdentity({ manifest: value, projectId: binding.projectId, actionId: binding.actionId, sourcePath: binding.sourcePath, collectionPath: binding.collectionPath, humanNotes, createContractDigest: createContract.digest });
  return {
    operation: "candidate_create",
    manifest: value,
    binding: structuredClone(binding),
    createContractDigest: createContract.digest,
    candidateId: value.candidateId,
    row,
    rowId: identity.value,
    model,
    root: model.root,
    format: "json",
    sourceAfterContent: afterText,
    semanticDigest,
    idempotencyKey,
    textArtifact: artifact,
  };
}

function assertBinding(value) {
  const strings = ["projectId", "runId", "actionId", "sourcePath", "collectionPath", "canonicalFileKey", "baseDocumentEtag", "ruleDigest"];
  if (!value || strings.some((field) => typeof value[field] !== "string" || !value[field])) fail("CANDIDATE_CREATE_BINDING_INVALID");
  if (!Number.isSafeInteger(value.fencingToken) || value.fencingToken < 1) fail("CANDIDATE_CREATE_BINDING_INVALID");
}
function assertCreateContract(value, binding) {
  if (!isPlainObject(value) || value.collectionKind !== "array" || value.contractId !== binding.createContractId || value.digest !== binding.createContractDigest
    || !Array.isArray(value.requiredFields) || !Array.isArray(value.writableFields) || !Array.isArray(value.serverOwnedFields) || !Array.isArray(value.uniqueKeys)) fail("CANDIDATE_CREATE_AUTHORITY_STALE");
}
function assertRowSchema(row, schema, { requireAll = true } = {}) {
  if (requireAll) return assertCandidateRowSchema(schema, row);
  const partial = { ...structuredClone(schema), required: [] };
  assertCandidateRowSchema(partial, row);
}
function assertUniqueKeys(rows, row, keys, allowMissing = false) {
  for (const fields of keys) {
    if (!Array.isArray(fields) || !fields.length || fields.some((field) => typeof field !== "string")) fail("CANDIDATE_CREATE_UNIQUE_KEY_INVALID");
    if (fields.some((field) => !Object.hasOwn(row, field))) {
      if (allowMissing) continue;
      fail("CANDIDATE_CREATE_UNIQUE_KEY_INVALID");
    }
    if (rows.some((candidate) => fields.every((field) => canonicalJson(candidate?.[field]) === canonicalJson(row[field])))) fail("CANDIDATE_CREATE_UNIQUE_CONFLICT");
  }
}
function bindHumanNotes(row, humanNotes, allowedFields, defaults) {
  if (humanNotes == null) {
    for (const field of allowedFields) row[field] = typeof defaults[field] === "string" ? defaults[field] : "";
    return;
  }
  if (!isPlainObject(humanNotes) || typeof humanNotes.field !== "string" || typeof humanNotes.text !== "string" || !DIGEST.test(humanNotes.digest)
    || digest(humanNotes.text) !== humanNotes.digest || !allowedFields.has(humanNotes.field)) fail("CANDIDATE_CREATE_HUMAN_NOTES_INVALID");
  row[humanNotes.field] = humanNotes.text;
}
function assertPreparedArtifact(artifact, proposed, policy = {}, expectedPath = null) {
  if (!proposed || !isPlainObject(artifact) || artifact.beforeExists !== false || artifact.beforeDigest !== null || typeof artifact.path !== "string"
    || (expectedPath !== null && artifact.path !== expectedPath) || artifact.afterContent !== proposed.afterContent || artifact.afterDigest !== proposed.afterDigest) fail("CANDIDATE_CREATE_TEXT_ARTIFACT_INVALID");
  if (Number.isSafeInteger(policy.maxBytes) && Buffer.byteLength(artifact.afterContent, "utf8") > policy.maxBytes) fail("CANDIDATE_CREATE_TEXT_ARTIFACT_INVALID");
}
function exact(value, fields, label) { if (!isPlainObject(value) || Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) invalid(`${label} fields are invalid`); }
function requiredSafe(value, label) { if (typeof value !== "string" || !SAFE_ID.test(value)) invalid(`${label} is invalid`); }
function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function digest(value) { return crypto.createHash("sha256").update(value, "utf8").digest("hex"); }
function etag(value) { return `"${digest(value)}"`; }
function invalid(message, code = "CANDIDATE_CREATE_MANIFEST_INVALID") { throw Object.assign(new Error(message), { code }); }
function fail(code) { throw Object.assign(new Error(code), { code }); }
