/**
 * Durable, fail-closed fencing allocation for one canonical file identity.
 *
 * State is append-only apart from `tail-anchor.json` and `head.json`.  Those
 * two files are deliberately independent: either one disagreeing with the
 * immutable record chain makes future admission unavailable. Admission is the
 * fixed, empty `admission.lock` directory, rather than a replaceable file
 * lock. Its owner is attested by the separate admission head, so B5 may claim
 * the directory with one rename to a unique, absent target without overwriting.
 */
import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, readdir, rm, rmdir, stat } from "node:fs/promises";
import { atomicWrite, exclusiveCreateLock } from "./atomic-file.mjs";

const VERSION = 1;
const KEY_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^[1-9][0-9]*$/;

export class FencingLockError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "FencingLockError";
    this.code = code;
  }
}

/**
 * Node cannot request Windows rename-no-replace. B5 may claim the fixed empty
 * admission directory by renaming it to a unique target proven absent, but it
 * must never rename over an existing target or overwrite an admission lock.
 */
export const B5_PLATFORM_CONSTRAINTS = Object.freeze([
  "WINDOWS_DIRECTORY_RENAME_TARGET_MUST_BE_UNIQUE_AND_ABSENT",
]);

/** Create an allocator rooted at an application-private durable directory. */
export function createFencingAllocator({ stateRoot, now = () => new Date().toISOString(), randomUUID = crypto.randomUUID } = {}) {
  const root = requireAbsolutePath(stateRoot, "stateRoot");
  if (typeof now !== "function" || typeof randomUUID !== "function") throw new TypeError("now and randomUUID must be functions.");

  return Object.freeze({
    allocate: (input) => allocate(root, input, { now, randomUUID }),
    probe: (input) => probe(root, input),
    heartbeat: (lease) => heartbeat(root, lease, { now }),
    markEvidencePending: (lease) => markEvidencePending(root, lease, { now }),
    persistOwnedEvidence: (lease, evidence) => persistOwnedEvidence(root, lease, evidence, { now }),
    release: (lease) => release(root, lease),
  });
}

async function allocate(root, input, deps) {
  const request = validateAllocationInput(input);
  const layout = layoutFor(root, request.canonicalFileKey);
  await mkdir(layout.keyRoot, { recursive: true });
  await Promise.all([mkdir(layout.recordsDirectory, { recursive: true }), mkdir(layout.ownersDirectory, { recursive: true }), mkdir(layout.evidenceDirectory, { recursive: true })]);
  const allocatorToken = deps.randomUUID();
  assertUuid(allocatorToken, "allocator token");
  try {
    await exclusiveCreateLock(layout.allocatorLock, { protocolVersion: VERSION, allocatorToken });
  } catch (error) {
    if (error?.code === "EEXIST") throw unavailable("ENTRY_ACTION_FENCING_ALLOCATOR_BUSY", "Another allocator holds this canonical file key.", error);
    throw unavailable("ENTRY_ACTION_FENCING_UNAVAILABLE", "Cannot acquire the durable allocator lock.", error);
  }
  try {
    const state = await readState(layout, request.canonicalFileKey);
    const fencingToken = state.latestToken + 1;
    const recordWithoutHash = {
      protocolVersion: VERSION,
      canonicalFileKey: request.canonicalFileKey,
      fencingToken,
      runId: request.runId,
      jobInstanceId: request.jobInstanceId,
      issuedAt: deps.now(),
      previousRecordHash: state.latestHash,
    };
    const record = { ...recordWithoutHash, recordHash: hash(recordWithoutHash) };
    await exclusiveCreateLock(recordPath(layout, fencingToken), record);
    const anchor = { protocolVersion: VERSION, canonicalFileKey: request.canonicalFileKey, fencingToken, recordHash: record.recordHash };
    // Anchors and heads are the only mutable files. Admission locks are never overwritten.
    await atomicWrite(layout.tailAnchor, json(anchor));
    await atomicWrite(layout.head, json({ ...anchor, tailAnchorHash: hash(anchor) }));

    const ownerToken = deps.randomUUID();
    assertUuid(ownerToken, "ownerToken");
    const ownerWithoutHash = {
      protocolVersion: VERSION,
      canonicalFileKey: request.canonicalFileKey,
      runId: request.runId,
      ownerToken,
      fencingToken,
      jobInstanceId: request.jobInstanceId,
      phase: "launching",
      createdAt: deps.now(),
    };
    const owner = { ...ownerWithoutHash, ownerHash: hash(ownerWithoutHash) };
    // Persist the owner identity before the admission directory becomes visible.
    await exclusiveCreateLock(ownerPath(layout, ownerToken), owner);
    try {
      if (await directoryExists(layout.admissionDirectory)) throw Object.assign(new Error("Admission exists."), { code: "EEXIST" });
      await atomicWrite(layout.admissionHead, json({ protocolVersion: VERSION, canonicalFileKey: request.canonicalFileKey, ownerToken, ownerHash: owner.ownerHash }));
      await mkdir(layout.admissionDirectory);
      try { await assertNoRecoveryClaim(layout); }
      catch (error) {
        await rmdir(layout.admissionDirectory).catch(() => {});
        throw error;
      }
    } catch (error) {
      if (error?.code === "EEXIST") throw unavailable("ENTRY_ACTION_ADMISSION_BUSY", "An active admission lock already exists.", error);
      throw unavailable("ENTRY_ACTION_FENCING_UNAVAILABLE", "Cannot create the admission directory lock.", error);
    }
    return leaseFromOwner(owner);
  } finally {
    await rm(layout.allocatorLock, { force: true }).catch((error) => {
      throw unavailable("ENTRY_ACTION_FENCING_UNAVAILABLE", "Cannot release allocator lock; future allocation is fail-closed.", error);
    });
  }
}

async function probe(root, input) {
  const canonicalFileKey = validateKey(input?.canonicalFileKey);
  const layout = layoutFor(root, canonicalFileKey);
  await validateExistingState(layout, canonicalFileKey);
  let names;
  try { names = await readdir(layout.admissionDirectory, { withFileTypes: true }); }
  catch (error) {
    if (error?.code === "ENOENT") return { status: "absent" };
    throw unavailable("ENTRY_ACTION_FENCING_UNAVAILABLE", "Cannot inspect admission lock.", error);
  }
  if (names.length !== 0) throw integrity("The fixed claimable admission directory must be empty.");
  const admission = await readStrict(layout.admissionHead, validateAdmissionHead);
  const owner = await readStrict(ownerPath(layout, admission.ownerToken), validateOwner);
  if (owner.canonicalFileKey !== canonicalFileKey || owner.ownerToken !== admission.ownerToken || owner.ownerHash !== admission.ownerHash) throw integrity("Admission owner does not match its durable head.");
  const phase = await readPhase(layout, owner);
  return { status: "owned", phase, lease: leaseFromOwner(owner) };
}

async function markEvidencePending(root, lease, deps) {
  const owner = validateLease(lease);
  const current = await probe(root, owner);
  assertCurrentOwner(current, owner);
  if (current.phase !== "launching") throw unavailable("ENTRY_ACTION_EVIDENCE_PHASE_INVALID", "Evidence can only advance from launching to evidence_pending.");
  const layout = layoutFor(root, owner.canonicalFileKey);
  const evidence = { protocolVersion: VERSION, canonicalFileKey: owner.canonicalFileKey, ownerToken: owner.ownerToken, ownerHash: owner.ownerHash, phase: "evidence_pending", recordedAt: deps.now() };
  try { await exclusiveCreateLock(evidencePath(layout, owner.ownerToken), evidence); }
  catch (error) { throw unavailable("ENTRY_ACTION_EVIDENCE_PHASE_INVALID", "Evidence phase already exists or cannot be persisted.", error); }
  return { ...owner, phase: "evidence_pending" };
}

async function heartbeat(root, lease, deps) {
  const owner = validateLease(lease);
  const current = await probe(root, owner);
  assertCurrentOwner(current, owner);
  const layout = layoutFor(root, owner.canonicalFileKey);
  const directory = path.join(layout.heartbeatDirectory, owner.ownerToken);
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || !/^\d+\.json$/.test(entry.name))) throw integrity("Heartbeat ledger is malformed.");
  const sequence = entries.length + 1;
  const record = { protocolVersion: VERSION, canonicalFileKey: owner.canonicalFileKey, ownerToken: owner.ownerToken, ownerHash: owner.ownerHash, phase: current.phase, sequence, recordedAt: deps.now() };
  try { await exclusiveCreateLock(path.join(directory, `${sequence}.json`), record); }
  catch (error) { throw unavailable("ENTRY_ACTION_ADMISSION_OWNERSHIP_CHANGED", "Heartbeat cannot be durably recorded for this owner.", error); }
  return { ...owner, phase: current.phase, heartbeatSequence: sequence };
}

async function persistOwnedEvidence(root, lease, evidence, deps) {
  const owner = validateLease(lease);
  const supervisorEvidence = validateSupervisorEvidence(evidence, owner.jobInstanceId);
  const current = await probe(root, owner);
  assertCurrentOwner(current, owner);
  if (current.phase !== "launching") throw unavailable("ENTRY_ACTION_EVIDENCE_PHASE_INVALID", "Owned evidence can only advance from launching.");
  const layout = layoutFor(root, owner.canonicalFileKey);
  await mkdir(layout.ownedEvidenceDirectory, { recursive: true });
  const record = { protocolVersion: VERSION, canonicalFileKey: owner.canonicalFileKey, ownerToken: owner.ownerToken, ownerHash: owner.ownerHash, jobInstanceId: owner.jobInstanceId, phase: "evidence_persisted", helper: supervisorEvidence.helper, child: supervisorEvidence.child, recordedAt: deps.now() };
  try { await exclusiveCreateLock(ownedEvidencePath(layout, owner.ownerToken), record); }
  catch (error) { throw unavailable("ENTRY_ACTION_EVIDENCE_PHASE_INVALID", "Owned evidence already exists or cannot be persisted.", error); }
  return { ...owner, phase: "evidence_persisted" };
}

async function release(root, lease) {
  const owner = validateLease(lease);
  const current = await probe(root, owner);
  assertCurrentOwner(current, owner);
  if (current.phase !== "evidence_persisted") throw unavailable("ENTRY_ACTION_EVIDENCE_PHASE_INVALID", "Admission cannot be released before owned evidence is durable.");
  const layout = layoutFor(root, owner.canonicalFileKey);
  try {
    // The fixed lock directory is empty. A later owner cannot create it before
    // this rmdir completes, and stale callers fail ownership comparison above.
    await rmdir(layout.admissionDirectory);
  } catch (error) {
    throw unavailable("ENTRY_ACTION_ADMISSION_OWNERSHIP_CHANGED", "Admission ownership changed; lock was not released.", error);
  }
  return { released: true, fencingToken: owner.fencingToken };
}

async function readState(layout, key) {
  await assertNoRecoveryClaim(layout);
  const state = await validateExistingState(layout, key, { allowSingleTailRecovery: true });
  if (state.needsReanchor) await publishAnchors(layout, state.recoveryAnchor);
  return state;
}

async function validateExistingState(layout, key, { allowSingleTailRecovery = false } = {}) {
  const recordDirExists = await fileExists(layout.recordsDirectory);
  const anchorExists = await fileExists(layout.tailAnchor);
  const headExists = await fileExists(layout.head);
  if (!recordDirExists && !anchorExists && !headExists) return { latestToken: 0, latestHash: null };
  if (recordDirExists && !anchorExists && !headExists) {
    const entries = await readdir(layout.recordsDirectory);
    if (entries.length === 0) return { latestToken: 0, latestHash: null };
  }
  if (!recordDirExists || !anchorExists || !headExists) throw integrity("Ledger, tail anchor, and head must either all exist or all be absent.");
  const entries = await readdir(layout.recordsDirectory, { withFileTypes: true });
  if (entries.length === 0 || entries.some((entry) => !entry.isFile() || !/^\d+\.json$/.test(entry.name))) throw integrity("Ledger contains an invalid record name.");
  const tokens = entries.map((entry) => Number(entry.name.slice(0, -5))).sort((a, b) => a - b);
  let previousHash = null;
  const recordHashes = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== index + 1) throw integrity("Ledger fencing tokens are not contiguous.");
    const record = await readStrict(recordPath(layout, tokens[index]), validateRecord);
    if (record.canonicalFileKey !== key || record.fencingToken !== tokens[index] || record.previousRecordHash !== previousHash) throw integrity("Ledger record chain is inconsistent.");
    previousHash = record.recordHash;
    recordHashes.set(record.fencingToken, record.recordHash);
  }
  const anchor = await readStrict(layout.tailAnchor, validateAnchor);
  const head = await readStrict(layout.head, validateHead);
  const anchoredHash = recordHashes.get(anchor.fencingToken);
  if (anchor.canonicalFileKey !== key || !anchoredHash || anchor.recordHash !== anchoredHash || head.canonicalFileKey !== key || head.fencingToken !== anchor.fencingToken || head.recordHash !== anchor.recordHash || head.tailAnchorHash !== hash(anchor)) throw integrity("Tail anchor and head do not attest to the same ledger record.");
  const latestToken = tokens.at(-1);
  if (anchor.fencingToken === latestToken) return { latestToken, latestHash: previousHash, needsReanchor: false };
  if (allowSingleTailRecovery && anchor.fencingToken + 1 === latestToken) {
    return { latestToken, latestHash: previousHash, needsReanchor: true, recoveryAnchor: { protocolVersion: VERSION, canonicalFileKey: key, fencingToken: latestToken, recordHash: previousHash } };
  }
  throw integrity("Ledger has records beyond its valid anchor and head.");
}

async function publishAnchors(layout, anchor) {
  // Ordered publication is intentional: a crash after the tail write leaves a
  // tail/head disagreement, which remains fail-closed rather than guessed at.
  await atomicWrite(layout.tailAnchor, json(anchor));
  await atomicWrite(layout.head, json({ ...anchor, tailAnchorHash: hash(anchor) }));
}

async function readPhase(layout, owner) {
  try {
    const owned = await readStrict(ownedEvidencePath(layout, owner.ownerToken), validateOwnedEvidence);
    if (owned.canonicalFileKey !== owner.canonicalFileKey || owned.ownerHash !== owner.ownerHash || owned.jobInstanceId !== owner.jobInstanceId) throw integrity("Owned evidence does not belong to the admission owner.");
    return "evidence_persisted";
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    const evidence = await readStrict(evidencePath(layout, owner.ownerToken), validateEvidence);
    if (evidence.canonicalFileKey !== owner.canonicalFileKey || evidence.ownerHash !== owner.ownerHash) throw integrity("Evidence does not belong to the admission owner.");
    return "evidence_pending";
  } catch (error) {
    if (error?.code === "ENOENT") return "launching";
    throw error;
  }
}

function layoutFor(root, key) { const keyRoot = path.join(root, key); return { keyRoot, recordsDirectory: path.join(keyRoot, "records"), ownersDirectory: path.join(keyRoot, "owners"), evidenceDirectory: path.join(keyRoot, "evidence"), ownedEvidenceDirectory: path.join(keyRoot, "owned-evidence"), heartbeatDirectory: path.join(keyRoot, "heartbeats"), quarantineDirectory: path.join(keyRoot, "quarantine"), allocatorLock: path.join(keyRoot, "allocator.lock"), tailAnchor: path.join(keyRoot, "tail-anchor.json"), head: path.join(keyRoot, "head.json"), admissionHead: path.join(keyRoot, "admission-head.json"), admissionDirectory: path.join(keyRoot, "admission.lock") }; }
export function fencingLayoutForRecovery(stateRoot, canonicalFileKey) { return layoutFor(requireAbsolutePath(stateRoot, "stateRoot"), validateKey(canonicalFileKey)); }
export async function readCurrentFencingAdmission(stateRoot, canonicalFileKey, { requireAdmissionDirectory = true } = {}) {
  const layout = fencingLayoutForRecovery(stateRoot, canonicalFileKey);
  if (requireAdmissionDirectory && !await directoryExists(layout.admissionDirectory)) return null;
  const head = await readStrict(layout.admissionHead, validateAdmissionHead);
  const owner = await readStrict(ownerPath(layout, head.ownerToken), validateOwner);
  if (head.canonicalFileKey !== canonicalFileKey || owner.canonicalFileKey !== canonicalFileKey || owner.ownerHash !== head.ownerHash) throw integrity("Admission head does not attest to its owner.");
  return leaseFromOwner(owner);
}
export async function findFencingLeaseByRunId(stateRoot, runId) {
  const root = requireAbsolutePath(stateRoot, "stateRoot"); const matches = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !KEY_RE.test(entry.name)) continue;
    const owners = path.join(root, entry.name, "owners");
    for (const file of await readdir(owners).catch(() => [])) {
      try { const owner = JSON.parse(await readFile(path.join(owners, file), "utf8")); validateOwner(owner); if (owner.runId === runId) matches.push(leaseFromOwner(owner)); } catch { throw integrity("Fencing owner index is unreadable."); }
    }
  }
  if (matches.length !== 1) return null; return matches[0];
}
export async function readFencingOwnedEvidence(stateRoot, lease) {
  const layout = fencingLayoutForRecovery(stateRoot, lease.canonicalFileKey);
  const owner = await readStrict(ownerPath(layout, lease.ownerToken), validateOwner);
  if (owner.runId !== lease.runId || owner.ownerHash !== lease.ownerHash) throw integrity("Recovery lease ownership changed.");
  const evidence = await readStrict(ownedEvidencePath(layout, lease.ownerToken), validateOwnedEvidence);
  if (evidence.ownerHash !== owner.ownerHash || evidence.jobInstanceId !== owner.jobInstanceId) throw integrity("Recovery evidence ownership changed.");
  return { phase: "evidence_persisted", evidence: { helper: evidence.helper, child: evidence.child } };
}
function recordPath(layout, token) { return path.join(layout.recordsDirectory, `${token}.json`); }
function ownerPath(layout, ownerToken) { return path.join(layout.ownersDirectory, `${ownerToken}.json`); }
function evidencePath(layout, ownerToken) { return path.join(layout.evidenceDirectory, `${ownerToken}.json`); }
function ownedEvidencePath(layout, ownerToken) { return path.join(layout.ownedEvidenceDirectory, `${ownerToken}.json`); }
function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function readStrict(file, validator) {
  let text;
  try { text = await readFile(file, "utf8"); }
  catch (error) { if (error?.code === "ENOENT") throw error; throw integrity(`Cannot read durable record ${path.basename(file)}.`); }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw integrity(`Durable record ${path.basename(file)} is not JSON.`); }
  validator(parsed);
  return parsed;
}
async function fileExists(file) { try { await stat(file); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
async function directoryExists(directory) { try { return (await stat(directory)).isDirectory(); } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
async function assertNoRecoveryClaim(layout) {
  let claims;
  try { claims = await readdir(layout.quarantineDirectory, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return; throw integrity("Cannot inspect recovery quarantine."); }
  if (claims.length !== 0) throw unavailable("ENTRY_ACTION_RECOVERY_PENDING", "A nonterminal recovery claim blocks new admission.");
}
function validateAllocationInput(input) { if (!input || typeof input !== "object") throw new TypeError("allocation input is required."); const jobInstanceId = requireString(input.jobInstanceId, "jobInstanceId"); assertUuid(jobInstanceId, "jobInstanceId"); return { canonicalFileKey: validateKey(input.canonicalFileKey), runId: requireString(input.runId, "runId"), jobInstanceId }; }
function validateLease(value) { if (!value || typeof value !== "object") throw new TypeError("lease is required."); const owner = { canonicalFileKey: validateKey(value.canonicalFileKey), runId: requireString(value.runId, "runId"), ownerToken: requireString(value.ownerToken, "ownerToken"), fencingToken: value.fencingToken, jobInstanceId: requireString(value.jobInstanceId, "jobInstanceId"), ownerHash: requireString(value.ownerHash, "ownerHash") }; assertUuid(owner.ownerToken, "ownerToken"); if (!Number.isSafeInteger(owner.fencingToken) || owner.fencingToken < 1) throw new TypeError("fencingToken must be a positive safe integer."); return owner; }
function leaseFromOwner(owner) { return Object.freeze({ canonicalFileKey: owner.canonicalFileKey, runId: owner.runId, ownerToken: owner.ownerToken, fencingToken: owner.fencingToken, jobInstanceId: owner.jobInstanceId, ownerHash: owner.ownerHash }); }
function validateRecord(value) { assertExact(value, ["protocolVersion", "canonicalFileKey", "fencingToken", "runId", "jobInstanceId", "issuedAt", "previousRecordHash", "recordHash"]); if (value.protocolVersion !== VERSION || !KEY_RE.test(value.canonicalFileKey) || !Number.isSafeInteger(value.fencingToken) || value.fencingToken < 1 || !isUuid(value.jobInstanceId) || typeof value.previousRecordHash !== "string" && value.previousRecordHash !== null || !isHash(value.recordHash)) throw integrity("Ledger record schema is invalid."); const { recordHash, ...withoutHash } = value; if (hash(withoutHash) !== recordHash) throw integrity("Ledger record hash is invalid."); }
function validateAnchor(value) { assertExact(value, ["protocolVersion", "canonicalFileKey", "fencingToken", "recordHash"]); if (value.protocolVersion !== VERSION || !KEY_RE.test(value.canonicalFileKey) || !Number.isSafeInteger(value.fencingToken) || value.fencingToken < 1 || !isHash(value.recordHash)) throw integrity("Tail anchor schema is invalid."); }
function validateHead(value) { assertExact(value, ["protocolVersion", "canonicalFileKey", "fencingToken", "recordHash", "tailAnchorHash"]); if (value.protocolVersion !== VERSION || !KEY_RE.test(value.canonicalFileKey) || !Number.isSafeInteger(value.fencingToken) || value.fencingToken < 1 || !isHash(value.recordHash) || !isHash(value.tailAnchorHash)) throw integrity("Head schema is invalid."); }
function validateOwner(value) { assertExact(value, ["protocolVersion", "canonicalFileKey", "runId", "ownerToken", "fencingToken", "jobInstanceId", "phase", "createdAt", "ownerHash"]); if (value.protocolVersion !== VERSION || !KEY_RE.test(value.canonicalFileKey) || !isUuid(value.ownerToken) || !Number.isSafeInteger(value.fencingToken) || value.fencingToken < 1 || !isUuid(value.jobInstanceId) || value.phase !== "launching" || !isHash(value.ownerHash)) throw integrity("Owner schema is invalid."); const { ownerHash, ...withoutHash } = value; if (hash(withoutHash) !== ownerHash) throw integrity("Owner hash is invalid."); }
function validateEvidence(value) { assertExact(value, ["protocolVersion", "canonicalFileKey", "ownerToken", "ownerHash", "phase", "recordedAt"]); if (value.protocolVersion !== VERSION || !KEY_RE.test(value.canonicalFileKey) || !isUuid(value.ownerToken) || !isHash(value.ownerHash) || value.phase !== "evidence_pending") throw integrity("Evidence schema is invalid."); }
function validateOwnedEvidence(value) { assertExact(value, ["protocolVersion", "canonicalFileKey", "ownerToken", "ownerHash", "jobInstanceId", "phase", "helper", "child", "recordedAt"]); if (value.protocolVersion !== VERSION || !KEY_RE.test(value.canonicalFileKey) || !isUuid(value.ownerToken) || !isHash(value.ownerHash) || !isUuid(value.jobInstanceId) || value.phase !== "evidence_persisted") throw integrity("Owned evidence schema is invalid."); validateProcessEvidence(value.helper, "helper"); validateProcessEvidence(value.child, "child"); }
function validateAdmissionHead(value) { assertExact(value, ["protocolVersion", "canonicalFileKey", "ownerToken", "ownerHash"]); if (value.protocolVersion !== VERSION || !KEY_RE.test(value.canonicalFileKey) || !isUuid(value.ownerToken) || !isHash(value.ownerHash)) throw integrity("Admission head schema is invalid."); }
function validateSupervisorEvidence(value, jobInstanceId) { assertExact(value, ["jobInstanceId", "helper", "child"]); if (value.jobInstanceId !== jobInstanceId || !isUuid(value.jobInstanceId)) throw unavailable("ENTRY_ACTION_OWNED_EVIDENCE_INVALID", "Supervisor evidence jobInstanceId does not match this lease."); validateProcessEvidence(value.helper, "helper"); validateProcessEvidence(value.child, "child"); return value; }
function validateProcessEvidence(value, label) { assertExact(value, ["pid", "creationFileTime"]); if (!isPositiveDecimal(value.pid) || !isUnsignedDecimal(value.creationFileTime)) throw unavailable("ENTRY_ACTION_OWNED_EVIDENCE_INVALID", `${label} ownership evidence must use unsigned decimal strings and a positive pid.`); }
function assertExact(value, keys) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) throw integrity("Unexpected durable record schema."); }
function assertCurrentOwner(current, owner) { if (current.status !== "owned" || current.lease.ownerToken !== owner.ownerToken || current.lease.ownerHash !== owner.ownerHash || current.lease.runId !== owner.runId || current.lease.fencingToken !== owner.fencingToken || current.lease.jobInstanceId !== owner.jobInstanceId) throw unavailable("ENTRY_ACTION_ADMISSION_OWNERSHIP_CHANGED", "Caller no longer owns the admission lock."); }
function validateKey(value) { if (typeof value !== "string" || !KEY_RE.test(value)) throw new TypeError("canonicalFileKey must be a lowercase SHA-256 hex string."); return value; }
function requireString(value, label) { if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string.`); return value; }
function requireAbsolutePath(value, label) { if (typeof value !== "string" || !path.isAbsolute(value)) throw new TypeError(`${label} must be an absolute path.`); return value; }
function assertUuid(value, label) { if (!isUuid(value)) throw new TypeError(`${label} must be a UUID.`); }
function isUuid(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function isHash(value) { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function isUnsignedDecimal(value) { return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value); }
function isPositiveDecimal(value) { return typeof value === "string" && /^[1-9][0-9]*$/.test(value); }
function unavailable(code, message, cause) { return new FencingLockError(code, message, cause ? { cause } : {}); }
function integrity(message) { return new FencingLockError("ENTRY_ACTION_FENCING_INTEGRITY_UNAVAILABLE", message); }
