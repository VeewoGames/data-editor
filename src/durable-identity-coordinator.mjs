import crypto from "node:crypto";
import path from "node:path";
import { parseCsv, serializeCsv } from "./csv-codec.mjs";
import { buildDocumentModel, getRows } from "./document-model.mjs";
import { canonicalFileIdentity } from "./canonical-file-identity.mjs";
import { normalizeDataFileVirtualPath, readTextFile, resolveInsideRoot, writeTextFile } from "./file-service.mjs";
import { buildEmbeddedIdentityPromotion, IdentityPromotionError, assertUniqueEmbeddedIdentity } from "./identity-promotion.mjs";
import { completeIdentityPromotion, createIdentityPromotionIntent, createIdentityPromotionJournal } from "./identity-promotion-journal.mjs";
import { parseJson, serializeJson } from "./json-codec.mjs";
import { findCapabilityBinding } from "./project-capability-registry.mjs";
import { rowDigest } from "./row-digest.mjs";

/**
 * Performs only the durable-identity half of an Entry Action admission.
 * It deliberately returns a receipt and canonical snapshot; it never starts a run.
 */
export async function promoteEmbeddedIdentity({
  projectContext,
  capabilityState,
  sourcePath,
  collectionPath,
  sourceRowIndex,
  expectedRowDigest,
  idempotencyKey,
  documentCommitCoordinator,
  validateCandidate,
  verifyPostReplaceCandidate,
  dependencies = {},
}) {
  const readText = dependencies.readText ?? readTextFile;
  const writeText = dependencies.writeText ?? writeTextFile;
  const canonicalIdentity = dependencies.canonicalFileIdentity ?? canonicalFileIdentity;
  const journal = dependencies.journal ?? createIdentityPromotionJournal({ directory: journalDirectory(projectContext) });
  const state = assertCapabilityState(capabilityState);
  const target = resolveIdentityPolicy(projectContext, state, sourcePath, collectionPath);
  const requiresContractAdmission = hasDocumentContractAdmission(projectContext, state, sourcePath);
  if (requiresContractAdmission && typeof validateCandidate !== "function") fail("DOCUMENT_CONTRACT_ADMISSION_SNAPSHOT_MISSING", "Identity promotion requires a document contract admission validator.", 503);
  if (requiresContractAdmission && typeof verifyPostReplaceCandidate !== "function") fail("DOCUMENT_CONTRACT_ADMISSION_SNAPSHOT_MISSING", "Identity promotion requires a post-replace document contract verifier.", 503);
  const index = assertSourceRowIndex(sourceRowIndex);
  const requestedDigest = assertExpectedRowDigest(expectedRowDigest);
  const key = assertIdempotencyKey(idempotencyKey);
  if (!documentCommitCoordinator?.withCommit) throw new TypeError("documentCommitCoordinator is required.");
  const fileIdentity = await canonicalIdentity(projectContext, sourcePath);

  return documentCommitCoordinator.withCommit({ projectContext, sourcePath }, async () => {
    const unresolved = (await journal.list()).find((entry) => entry?.kind === "identity_promotion"
      && entry.stage === "intent" && entry.idempotencyKey !== key
      && entry.sourcePath === sourcePath && entry.collectionPath === collectionPath);
    if (unresolved) fail("IDENTITY_PROMOTION_RECOVERY_PENDING", "A prior identity promotion for this target is awaiting recovery.", 503);
    const currentText = await readText(projectContext, sourcePath);
    const parsed = parseDocument(sourcePath, currentText);
    const model = buildDocumentModel(parsed.data, parsed.format, sourcePath);
    const rows = getRows(model, collectionPath);
    const currentRow = rows[index];
    if (!currentRow || typeof currentRow !== "object" || Array.isArray(currentRow)) {
      fail("IDENTITY_PROMOTION_TARGET_MISSING", "The requested row is no longer available.", 409);
    }
    const existing = await journal.read(key);
    if (existing && existing.kind !== "identity_promotion") fail("IDENTITY_PROMOTION_IDEMPOTENCY_CONFLICT", "idempotencyKey belongs to another operation.", 409);
    if (existing?.stage === "receipt") return replayReceipt({ existing, rows, policy: target.policy, sourcePath, collectionPath, index, parsed, currentText });
    if (existing?.stage === "intent") {
      const recovered = rows.filter((row) => row?.[target.policy.provider.field] === existing.durableId);
      if (recovered.length === 1) {
        const receipt = {
          version: 1, idempotencyKey: key, policyId: target.policy.id, durableId: existing.durableId, row: structuredClone(recovered[0]),
          sourcePath, collectionPath, canonicalFileKey: fileIdentity.canonicalFileKey, capabilityGeneration: existing.capabilityGeneration,
          manifestDigest: existing.manifestDigest, documentEtag: etag(currentText), canonicalRowDigest: rowDigest(recovered[0]),
          receiptDigest: digest(JSON.stringify({ idempotencyKey: key, durableId: existing.durableId, row: recovered[0] })),
        };
        await verifyAdmissionSnapshot({
          required: requiresContractAdmission,
          snapshot: existing.contractAdmission,
          verify: verifyPostReplaceCandidate,
          sourcePath, collectionPath, root: parsed.data, format: parsed.format, capabilityState: state,
        });
        await journal.write(completeIdentityPromotion(existing, receipt));
        return { replayed: true, receipt, root: parsed.data, format: parsed.format, documentEtag: etag(currentText) };
      }
    }
    if (rowDigest(currentRow) !== requestedDigest) fail("IDENTITY_PROMOTION_TARGET_STALE", "The canonical target row no longer matches the requested digest.", 409);

    const promotion = buildEmbeddedIdentityPromotion({
      row: currentRow,
      policy: target.policy,
      idempotencyKey: key,
      generateId: existing?.durableId ? () => existing.durableId : undefined,
    });
    const candidateRows = rows.map((row, rowIndex) => rowIndex === index ? promotion.row : row);
    assertUniqueEmbeddedIdentity(candidateRows, target.policy.provider.field, promotion.durableId);
    rows[index] = promotion.row;
    const candidateText = serializeDocument(parsed.format, model.root);
    const contractAdmission = existing?.contractAdmission ?? (typeof validateCandidate === "function" ? await validateCandidate({
      sourcePath,
      collectionPath,
      root: model.root,
      format: parsed.format,
      capabilityState: state,
      policy: target.policy,
      beforeText: currentText,
      candidateText,
    }) : null);
    // Retried intents must use their original admission, never silently replace it
    // with a fresh snapshot before the durable-id writer runs.
    await verifyAdmissionSnapshot({
      required: requiresContractAdmission,
      snapshot: contractAdmission,
      verify: verifyPostReplaceCandidate,
      sourcePath, collectionPath, root: model.root, format: parsed.format, capabilityState: state,
    });
    const intent = existing ?? createIdentityPromotionIntent({
      idempotencyKey: key,
      projectId: projectContext.projectId,
      sourcePath,
      collectionPath,
      sourceRowIndex: index,
      expectedRowDigest: requestedDigest,
      durableId: promotion.durableId,
      capabilityGeneration: state.generation,
      manifestDigest: state.manifestDigest,
      identityPolicyId: target.policy.id,
      canonicalFileKey: fileIdentity.canonicalFileKey,
      beforeDigest: digest(currentText),
      afterDigest: digest(candidateText),
      contractAdmission: contractAdmission ?? null,
    });
    if (!existing) await journal.write(intent);
    await writeText(projectContext, sourcePath, candidateText);

    const persistedText = await readText(projectContext, sourcePath);
    const persisted = parseDocument(sourcePath, persistedText);
    const persistedRows = getRows(buildDocumentModel(persisted.data, persisted.format, sourcePath), collectionPath);
    const matches = persistedRows.filter((row) => row?.[target.policy.provider.field] === promotion.durableId);
    if (matches.length !== 1 || digest(persistedText) !== digest(candidateText)) {
      fail("IDENTITY_PROMOTION_VERIFY_FAILED", "The durable identity promotion could not be verified after writing.", 503);
    }
    await verifyAdmissionSnapshot({
      required: requiresContractAdmission,
      snapshot: intent.contractAdmission,
      verify: verifyPostReplaceCandidate,
      sourcePath, collectionPath, root: persisted.data, format: persisted.format, capabilityState: state,
    });
    const receipt = {
      ...promotion.receipt,
      sourcePath,
      collectionPath,
      canonicalFileKey: fileIdentity.canonicalFileKey,
      capabilityGeneration: state.generation,
      manifestDigest: state.manifestDigest,
      documentEtag: etag(persistedText),
      canonicalRowDigest: rowDigest(matches[0]),
      receiptDigest: digest(JSON.stringify(promotion.receipt)),
    };
    await journal.write(completeIdentityPromotion(intent, receipt));
    return { replayed: false, receipt, root: persisted.data, format: persisted.format, documentEtag: etag(persistedText) };
  });
}

/** Reconciles only replaced-but-unreceipted promotions. It never creates or removes identity. */
export async function recoverPendingEmbeddedIdentityPromotions({ projectContext, capabilityState, verifyPostReplaceCandidate, dependencies = {} }) {
  const readText = dependencies.readText ?? readTextFile;
  const journal = dependencies.journal ?? createIdentityPromotionJournal({ directory: journalDirectory(projectContext) });
  const entries = await journal.list();
  const recovered = [];
  const pending = [];
  for (const entry of entries) {
    if (entry?.kind !== "identity_promotion" || entry.stage !== "intent" || entry.projectId !== projectContext.projectId) continue;
    try {
      const target = resolveIdentityPolicy(projectContext, assertCapabilityState(capabilityState), entry.sourcePath, entry.collectionPath);
      const requiresContractAdmission = hasDocumentContractAdmission(projectContext, capabilityState, entry.sourcePath);
      if (requiresContractAdmission && typeof verifyPostReplaceCandidate !== "function") throw Object.assign(new Error("DOCUMENT_CONTRACT_ADMISSION_SNAPSHOT_MISSING"), { code: "DOCUMENT_CONTRACT_ADMISSION_SNAPSHOT_MISSING" });
      const text = await readText(projectContext, entry.sourcePath);
      const parsed = parseDocument(entry.sourcePath, text);
      const rows = getRows(buildDocumentModel(parsed.data, parsed.format, entry.sourcePath), entry.collectionPath);
      const matches = rows.filter((row) => row?.[target.policy.provider.field] === entry.durableId);
      if (matches.length !== 1) { pending.push(entry.idempotencyKey); continue; }
      await verifyAdmissionSnapshot({
        required: requiresContractAdmission,
        snapshot: entry.contractAdmission,
        verify: verifyPostReplaceCandidate,
        sourcePath: entry.sourcePath, collectionPath: entry.collectionPath, root: parsed.data, format: parsed.format, capabilityState,
      });
      const receipt = {
        version: 1, idempotencyKey: entry.idempotencyKey, policyId: target.policy.id, durableId: entry.durableId, row: structuredClone(matches[0]),
        sourcePath: entry.sourcePath, collectionPath: entry.collectionPath, canonicalFileKey: entry.canonicalFileKey,
        capabilityGeneration: entry.capabilityGeneration, manifestDigest: entry.manifestDigest, documentEtag: etag(text),
        canonicalRowDigest: rowDigest(matches[0]), receiptDigest: digest(JSON.stringify({ idempotencyKey: entry.idempotencyKey, durableId: entry.durableId, row: matches[0] })),
      };
      await journal.write(completeIdentityPromotion(entry, receipt));
      recovered.push(entry.idempotencyKey);
    } catch { pending.push(entry.idempotencyKey); }
  }
  return { recovered, pending };
}

function replayReceipt({ existing, rows, policy, sourcePath, collectionPath, index, parsed, currentText }) {
  const receipt = existing.receipt;
  const matches = rows.filter((row) => row?.[policy.provider.field] === receipt?.durableId);
  if (!receipt || matches.length !== 1) fail("IDENTITY_PROMOTION_NEEDS_RECOVERY", "The promotion receipt cannot be reconciled with the canonical document.", 503);
  return { replayed: true, receipt, root: parsed.data, format: parsed.format, documentEtag: etag(currentText) };
}

function resolveIdentityPolicy(projectContext, state, sourcePath, collectionPath) {
  const virtualPath = normalizeDataFileVirtualPath(projectContext, sourcePath);
  const separator = virtualPath.indexOf("/");
  const policy = findCapabilityBinding(state, { engine: "identity-policy-v1", dataSourceId: virtualPath.slice(0, separator), path: virtualPath.slice(separator + 1), collection: collectionPath });
  if (!policy) fail("IDENTITY_PROMOTION_POLICY_UNAVAILABLE", "This Entry Action target has no active durable identity policy.", 409);
  if (policy.provider?.kind !== "embedded-v1") fail("IDENTITY_PROMOTION_PROVIDER_UNSUPPORTED", "Only embedded-v1 identity promotion is available.", 409);
  return { policy };
}

function hasDocumentContractAdmission(projectContext, state, sourcePath) {
  const virtualPath = normalizeDataFileVirtualPath(projectContext, sourcePath);
  const separator = virtualPath.indexOf("/");
  return (state.bindings?.documentContracts ?? []).some((binding) => binding.match?.dataSourceId === virtualPath.slice(0, separator)
    && binding.match?.path === virtualPath.slice(separator + 1));
}

function assertDocumentContractAdmission(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !Array.isArray(snapshot.contracts) || snapshot.contracts.length === 0) {
    fail("DOCUMENT_CONTRACT_ADMISSION_SNAPSHOT_MISSING", "Identity promotion is missing its document contract admission snapshot.", 503);
  }
}

async function verifyAdmissionSnapshot({ required, snapshot, verify, sourcePath, collectionPath, root, format, capabilityState }) {
  if (!required) return;
  assertDocumentContractAdmission(snapshot);
  await verify({ sourcePath, collectionPath, root, format, capabilityState, admissionSnapshot: snapshot });
}

function assertCapabilityState(state) {
  if (state?.status !== "active") fail("IDENTITY_PROMOTION_CAPABILITY_UNAVAILABLE", "Capability state is not active for durable identity promotion.", 409);
  return state;
}
function assertSourceRowIndex(value) { if (!Number.isInteger(value) || value < 0) fail("IDENTITY_PROMOTION_TARGET_MISSING", "A source row index is required before promotion.", 400); return value; }
function assertExpectedRowDigest(value) { if (typeof value !== "string" || !value) fail("IDENTITY_PROMOTION_TARGET_DIGEST_REQUIRED", "A target row digest is required before promotion.", 400); return value; }
function assertIdempotencyKey(value) { if (!/^[A-Za-z0-9_-]{8,}$/.test(String(value))) fail("IDENTITY_PROMOTION_IDEMPOTENCY_REQUIRED", "A safe idempotency key is required.", 400); return value; }
function parseDocument(sourcePath, text) { return path.extname(sourcePath).toLowerCase() === ".csv" ? { data: parseCsv(text), format: "csv" } : parseJson(text); }
function serializeDocument(format, root) { return format === "csv" ? serializeCsv(root) : serializeJson(root); }
function journalDirectory(context) { return resolveInsideRoot(context.projectRoot, path.join(context.runtimeDir, "identity-promotion-journal")); }
function digest(value) { return crypto.createHash("sha256").update(value, "utf8").digest("hex"); }
function etag(text) { return `"${digest(text)}"`; }
function fail(code, message, status) { throw Object.assign(new IdentityPromotionError(code, message), { status }); }
