import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rename, rmdir, stat, unlink } from "node:fs/promises";
import { exclusiveCreateLock } from "./atomic-file.mjs";
import { fencingLayoutForRecovery, findFencingLeaseByRunId, readCurrentFencingAdmission, readFencingOwnedEvidence } from "./fencing-lock.mjs";
/** Strict recovery classification and claim-first primitive. */
export async function claimAdmissionLock({ fixedPath, quarantineRoot, randomUUID = crypto.randomUUID }) {
  const claimDirectory = path.join(quarantineRoot, randomUUID());
  await mkdir(quarantineRoot, { recursive: true });
  await mkdir(claimDirectory, { recursive: false });
  const claimedPath = path.join(claimDirectory, "admission.lock");
  await rename(fixedPath, claimedPath);
  return { claimDirectory, claimedPath };
}
export async function claimFencingAdmission({ stateRoot, lease, randomUUID = crypto.randomUUID }) {
  const existing = await findExistingRecoveryClaim(stateRoot, lease);
  if (existing) {
    if (existing.lockPresent) return existing;
    const current = await readCurrentFencingAdmission(stateRoot, lease.canonicalFileKey);
    if (sameLease(current, lease)) {
      await rename(fencingLayoutForRecovery(stateRoot, lease.canonicalFileKey).admissionDirectory, existing.claimedPath);
      await verifyRecoveryClaim({ stateRoot, lease, ...existing });
      return { ...existing, lockPresent: true };
    }
    if (current === null) return existing;
    throw new Error("RECOVERY_ADMISSION_SUPERSEDED");
  }
  const current = await readCurrentFencingAdmission(stateRoot, lease.canonicalFileKey);
  if (!sameLease(current, lease)) throw new Error("RECOVERY_ADMISSION_SUPERSEDED");
  const layout = fencingLayoutForRecovery(stateRoot, lease.canonicalFileKey);
  const claimDirectory = path.join(layout.quarantineDirectory, randomUUID());
  await mkdir(layout.quarantineDirectory, { recursive: true });
  await mkdir(claimDirectory, { recursive: false });
  const claim = { recoveryProtocolVersion: 1, lockProtocolVersion: 1, phase: "claimed", ...lease };
  await exclusiveCreateLock(path.join(claimDirectory, "claim.json"), claim);
  const claimedPath = path.join(claimDirectory, "admission.lock");
  await rename(layout.admissionDirectory, claimedPath);
  await verifyRecoveryClaim({ stateRoot, lease, claimDirectory, claimedPath });
  return { claimDirectory, claimedPath, metadataPath: path.join(claimDirectory, "claim.json") };
}
export async function verifyRecoveryClaim({ stateRoot, lease, claimDirectory, claimedPath }) {
  const metadata = JSON.parse(await readFile(path.join(claimDirectory, "claim.json"), "utf8"));
  if (!sameLease(metadata, lease) || metadata.recoveryProtocolVersion !== 1 || metadata.lockProtocolVersion !== 1 || metadata.phase !== "claimed") throw new Error("RECOVERY_CLAIM_BINDING_INVALID");
  const headLease = await readCurrentFencingAdmission(stateRoot, lease.canonicalFileKey, { requireAdmissionDirectory: false });
  if (!sameLease(headLease, lease)) throw new Error("RECOVERY_ADMISSION_SUPERSEDED");
  if (!(await stat(claimedPath)).isDirectory()) throw new Error("RECOVERY_CLAIM_TARGET_INVALID");
  return metadata;
}
export async function writeCompletedRecoveryRecord({ stateRoot, canonicalFileKey, runId, ownerToken, ownerHash, jobInstanceId, fencingToken, schemaVersion = 1 }) {
  if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) throw new TypeError("fencingToken must be a positive safe integer.");
  if (typeof ownerHash !== "string" || !/^[0-9a-f]{64}$/.test(ownerHash) || typeof jobInstanceId !== "string" || jobInstanceId.length === 0) throw new TypeError("Completed recovery record requires exact durable owner identity.");
  const layout = fencingLayoutForRecovery(stateRoot, canonicalFileKey);
  const directory = path.join(layout.keyRoot, "recovery");
  await mkdir(directory, { recursive: true });
  const record = { schemaVersion, lockProtocolVersion: 1, canonicalFileKey, runId, ownerToken, ownerHash, jobInstanceId, fencingToken, disposition: "released", completed: true };
  await exclusiveCreateLock(completedRecordPath(directory, record), record);
  return record;
}
export async function readCompletedRecoveryRecord({ stateRoot, lease }) {
  const layout = fencingLayoutForRecovery(stateRoot, lease.canonicalFileKey);
  const filename = completedRecordPath(path.join(layout.keyRoot, "recovery"), lease);
  try {
    const record = JSON.parse(await readFile(filename, "utf8"));
    return exactCompletedRecord(record, lease) ? record : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("RECOVERY_COMPLETED_RECORD_INVALID", { cause: error });
  }
}
export async function inspectFencingRecovery({ stateRoot, runId, processIdentity, allowClaimedInspection = false }) {
  const lease = await findFencingLeaseByRunId(stateRoot, runId);
  if (!lease) return { decision: "error", reasonCode: "RECOVERY_TARGET_ABSENT_UNPROVEN", released: false, lease: null };
  const completedRecord = await readCompletedRecoveryRecord({ stateRoot, lease });
  if (completedRecord) return { decision: "completed", outcome: "already_recovered", released: true, lease, completedRecord };
  const claim = await findExistingRecoveryClaim(stateRoot, lease);
  if (claim && !allowClaimedInspection) return { decision: "insufficient", reasonCode: "RECOVERY_CLAIM_IN_PROGRESS", released: false, lease, claim };
  let state;
  try {
    state = await readFencingOwnedEvidence(stateRoot, lease);
  } catch (error) {
    return { decision: "error", reasonCode: "RECOVERY_EVIDENCE_CORRUPT", released: false, lease, cause: error };
  }
  return { ...inspectRecoveryEvidence({ state, processIdentity }), lease };
}
export async function recoverClaim({ inspection, releaseClaim, writeCompletedRecord }) {
  if (inspection?.decision === "active" || inspection?.decision === "insufficient") return { exitCode: 3, ...inspection, released: false };
  if (inspection?.decision !== "releasable") return { exitCode: 2, decision: "error", reasonCode: "RECOVERY_TARGET_ABSENT_UNPROVEN", released: false };
  await releaseClaim();
  await writeCompletedRecord();
  return { exitCode: 0, decision: "completed", outcome: "recovered", released: true };
}
export async function releaseClaimedAdmission({ claimDirectory, claimedPath }) {
  await rmdir(claimedPath).catch((error) => { if (error?.code !== "ENOENT") throw error; });
}
export async function finalizeClaimedRecovery({ claimDirectory }) {
  await unlink(path.join(claimDirectory, "claim.json")).catch((error) => { if (error?.code !== "ENOENT") throw error; });
  await rmdir(claimDirectory);
}
async function findExistingRecoveryClaim(stateRoot, lease) {
  const layout = fencingLayoutForRecovery(stateRoot, lease.canonicalFileKey);
  const entries = await (await import("node:fs/promises")).readdir(layout.quarantineDirectory, { withFileTypes: true }).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const claimDirectory = path.join(layout.quarantineDirectory, entry.name);
    try {
      const metadata = JSON.parse(await readFile(path.join(claimDirectory, "claim.json"), "utf8"));
      const claimedPath = path.join(claimDirectory, "admission.lock");
      if (sameLease(metadata, lease) && metadata.phase === "claimed") {
        const lockPresent = await stat(claimedPath).then((value) => value.isDirectory()).catch((error) => error?.code === "ENOENT" ? false : Promise.reject(error));
        return { claimDirectory, claimedPath, metadataPath: path.join(claimDirectory, "claim.json"), lockPresent };
      }
    } catch { throw new Error("RECOVERY_CLAIM_BINDING_INVALID"); }
  }
  return null;
}
export function inspectRecoveryEvidence({ state, processIdentity }) {
  if (!state || typeof state !== "object") return { decision: "insufficient", reasonCode: "RECOVERY_STATE_UNREADABLE", released: false };
  if (state.phase !== "evidence_persisted" || !state.evidence) return { decision: "insufficient", reasonCode: "RECOVERY_EVIDENCE_INSUFFICIENT", released: false };
  const { helper, child } = state.evidence;
  if (!validIdentity(helper) || !validIdentity(child)) return { decision: "insufficient", reasonCode: "RECOVERY_EVIDENCE_INVALID", released: false };
  const observed = processIdentity?.(helper, child);
  if (observed === true) return { decision: "active", reasonCode: "RECOVERY_PROCESS_ACTIVE", released: false };
  if (observed === false) return { decision: "releasable", reasonCode: "RECOVERY_PROCESS_ABSENT", released: false };
  return { decision: "insufficient", reasonCode: "RECOVERY_PROCESS_UNVERIFIABLE", released: false };
}

export function classifyRecoveryCommand({ inspection, completedRecord = null }) {
  if (inspection?.decision === "completed" || completedRecord?.completed === true) return { exitCode: 0, decision: "completed", outcome: "already_recovered", released: true };
  if (inspection?.decision === "releasable") return { exitCode: 0, decision: "releasable", released: false };
  if (inspection?.decision === "active" || inspection?.decision === "insufficient") return { exitCode: 3, ...inspection, released: false };
  return { exitCode: 2, decision: "error", reasonCode: "RECOVERY_TARGET_ABSENT_UNPROVEN", released: false };
}
function completedRecordPath(directory, { runId, ownerToken, fencingToken }) {
  return path.join(directory, `${encodeURIComponent(runId)}.${encodeURIComponent(ownerToken)}.${fencingToken}.json`);
}
function exactCompletedRecord(record, lease) {
  return record && record.schemaVersion === 1 && record.lockProtocolVersion === 1 && record.completed === true && record.disposition === "released" &&
    record.canonicalFileKey === lease.canonicalFileKey && record.runId === lease.runId &&
    record.ownerToken === lease.ownerToken && record.ownerHash === lease.ownerHash && record.jobInstanceId === lease.jobInstanceId && record.fencingToken === lease.fencingToken;
}
function sameLease(left, right) { return Boolean(left && right) && left.canonicalFileKey === right.canonicalFileKey && left.runId === right.runId && left.ownerToken === right.ownerToken && left.ownerHash === right.ownerHash && left.jobInstanceId === right.jobInstanceId && left.fencingToken === right.fencingToken; }
function validIdentity(value) {
  return value && typeof value.pid === "string" && /^[1-9][0-9]*$/.test(value.pid) && typeof value.creationFileTime === "string" && /^(?:0|[1-9][0-9]*)$/.test(value.creationFileTime);
}
