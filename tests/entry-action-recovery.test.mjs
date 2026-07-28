import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rename, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claimAdmissionLock, claimFencingAdmission, classifyRecoveryCommand, finalizeClaimedRecovery, inspectFencingRecovery, inspectRecoveryEvidence, readCompletedRecoveryRecord, recoverClaim, releaseClaimedAdmission, writeCompletedRecoveryRecord } from "../src/entry-action-recovery.mjs";
import { createFencingAllocator } from "../src/fencing-lock.mjs";
const id = { pid: "12", creationFileTime: "133000000000000001" };
test("inspect distinguishes active, releasable and insufficient without mutation", () => {
  const state = { phase: "evidence_persisted", evidence: { helper: id, child: { pid: "13", creationFileTime: "133000000000000002" } } };
  assert.equal(inspectRecoveryEvidence({ state, processIdentity: () => true }).decision, "active");
  assert.equal(inspectRecoveryEvidence({ state, processIdentity: () => false }).decision, "releasable");
  assert.equal(inspectRecoveryEvidence({ state, processIdentity: () => null }).decision, "insufficient");
  assert.equal(inspectRecoveryEvidence({ state: null }).decision, "insufficient");
});
test("recovery command exit contract preserves locks on uncertainty", () => {
  assert.equal(classifyRecoveryCommand({ inspection: { decision: "active" } }).exitCode, 3);
  assert.equal(classifyRecoveryCommand({ inspection: { decision: "insufficient" } }).exitCode, 3);
  assert.equal(classifyRecoveryCommand({ inspection: { decision: "releasable" } }).exitCode, 0);
  assert.equal(classifyRecoveryCommand({ completedRecord: { completed: true } }).decision, "completed");
});
test("claim first moves fixed admission lock to a unique quarantine target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-recovery-"));
  const fixed = path.join(root, "admission.lock"); await mkdir(fixed);
  const result = await claimAdmissionLock({ fixedPath: fixed, quarantineRoot: root, randomUUID: () => "claim" });
  await assert.rejects(() => stat(fixed));
  assert.equal((await stat(result.claimedPath)).isDirectory(), true);
});
test("recovery records completion only after release confirmation", async () => {
  const calls = [];
  const result = await recoverClaim({ inspection: { decision: "releasable" }, releaseClaim: async () => calls.push("release"), writeCompletedRecord: async () => calls.push("record") });
  assert.deepEqual(calls, ["release", "record"]); assert.equal(result.released, true);
  await assert.rejects(() => recoverClaim({ inspection: { decision: "releasable" }, releaseClaim: async () => { throw new Error("fail"); }, writeCompletedRecord: async () => calls.push("bad") }));
});
test("fencing claim derives only the canonical admission path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-recovery-")); const key = "a".repeat(64);
  const lease = await createFencingAllocator({ stateRoot: root }).allocate({ canonicalFileKey: key, runId: "claim-run", jobInstanceId: "10000000-0000-4000-8000-000000000001" });
  const claim = await claimFencingAdmission({ stateRoot: root, lease, randomUUID: () => "claim" });
  assert.equal((await stat(claim.claimedPath)).isDirectory(), true);
});
test("completed record is immutable and binds the exact fencing identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-recovery-")); const key = "b".repeat(64);
  const binding = { canonicalFileKey: key, runId: "run", ownerToken: "owner", ownerHash: "e".repeat(64), jobInstanceId: "10000000-0000-4000-8000-000000000001", fencingToken: 1 };
  const record = await writeCompletedRecoveryRecord({ stateRoot: root, ...binding });
  assert.equal(record.completed, true);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, key, "recovery", "run.owner.1.json"), "utf8")).fencingToken, 1);
  await assert.rejects(() => writeCompletedRecoveryRecord({ stateRoot: root, ...binding }));
});
test("completed record only matches the identical durable lease", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-recovery-")); const key = "c".repeat(64);
  const lease = { canonicalFileKey: key, runId: "run", ownerToken: "owner", ownerHash: "f".repeat(64), jobInstanceId: "10000000-0000-4000-8000-000000000001", fencingToken: 2 };
  await writeCompletedRecoveryRecord({ stateRoot: root, ...lease });
  assert.equal((await readCompletedRecoveryRecord({ stateRoot: root, lease })).completed, true);
  assert.equal(await readCompletedRecoveryRecord({ stateRoot: root, lease: { ...lease, fencingToken: 3 } }), null);
});
test("claimed admission is removed only through its claimed path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-recovery-")); const fixed = path.join(root, "admission.lock"); await mkdir(fixed);
  const claim = await claimAdmissionLock({ fixedPath: fixed, quarantineRoot: root, randomUUID: () => "claim" });
  await releaseClaimedAdmission(claim);
  await assert.rejects(() => stat(claim.claimedPath));
});
test("durable owned evidence drives claim-first recovery and exact completion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-recovery-"));
  const key = "d".repeat(64);
  const lease = await createFencingAllocator({ stateRoot: root }).allocate({ canonicalFileKey: key, runId: "recoverable-run", jobInstanceId: "10000000-0000-4000-8000-000000000001" });
  await createFencingAllocator({ stateRoot: root }).persistOwnedEvidence(lease, { jobInstanceId: lease.jobInstanceId, helper: id, child: { pid: "13", creationFileTime: "133000000000000002" } });
  const before = await inspectFencingRecovery({ stateRoot: root, runId: lease.runId, processIdentity: () => false });
  assert.equal(before.decision, "releasable");
  const claim = await claimFencingAdmission({ stateRoot: root, lease, randomUUID: () => "claim" });
  assert.equal((await inspectFencingRecovery({ stateRoot: root, runId: lease.runId, processIdentity: () => false })).reasonCode, "RECOVERY_CLAIM_IN_PROGRESS");
  const afterClaim = await inspectFencingRecovery({ stateRoot: root, runId: lease.runId, processIdentity: () => false, allowClaimedInspection: true });
  const completed = await recoverClaim({ inspection: afterClaim, releaseClaim: () => releaseClaimedAdmission(claim), writeCompletedRecord: () => writeCompletedRecoveryRecord({ stateRoot: root, ...lease }) });
  assert.equal(completed.released, true);
  assert.equal((await inspectFencingRecovery({ stateRoot: root, runId: lease.runId, processIdentity: () => null })).decision, "completed");
  const resumable = await claimFencingAdmission({ stateRoot: root, lease });
  assert.equal(resumable.lockPresent, false);
  await finalizeClaimedRecovery(resumable);
  await createFencingAllocator({ stateRoot: root }).allocate({ canonicalFileKey: key, runId: "next-run", jobInstanceId: "10000000-0000-4000-8000-000000000002" });
});
test("an old run cannot claim or release a later admission", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-recovery-")); const key = "e".repeat(64);
  const allocator = createFencingAllocator({ stateRoot: root });
  const oldLease = await allocator.allocate({ canonicalFileKey: key, runId: "old-run", jobInstanceId: "10000000-0000-4000-8000-000000000001" });
  await allocator.persistOwnedEvidence(oldLease, { jobInstanceId: oldLease.jobInstanceId, helper: id, child: { pid: "13", creationFileTime: "133000000000000002" } });
  await allocator.release(oldLease);
  const laterLease = await allocator.allocate({ canonicalFileKey: key, runId: "later-run", jobInstanceId: "10000000-0000-4000-8000-000000000002" });
  await allocator.persistOwnedEvidence(laterLease, { jobInstanceId: laterLease.jobInstanceId, helper: id, child: { pid: "13", creationFileTime: "133000000000000002" } });
  await assert.rejects(() => claimFencingAdmission({ stateRoot: root, lease: oldLease }), /RECOVERY_ADMISSION_SUPERSEDED/);
  assert.equal((await inspectFencingRecovery({ stateRoot: root, runId: laterLease.runId, processIdentity: () => true })).decision, "active");
});
test("a persisted nonterminal recovery claim blocks later admission", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-recovery-")); const key = "f".repeat(64);
  const allocator = createFencingAllocator({ stateRoot: root });
  const lease = await allocator.allocate({ canonicalFileKey: key, runId: "claimed-run", jobInstanceId: "10000000-0000-4000-8000-000000000001" });
  const claim = await claimFencingAdmission({ stateRoot: root, lease, randomUUID: () => "claim" });
  await assert.rejects(() => allocator.allocate({ canonicalFileKey: key, runId: "blocked-run", jobInstanceId: "10000000-0000-4000-8000-000000000002" }), (error) => error?.code === "ENTRY_ACTION_RECOVERY_PENDING");
  await releaseClaimedAdmission(claim);
});
test("a prepared claim resumes its rename instead of being treated as released", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-recovery-")); const key = "1".repeat(64);
  const allocator = createFencingAllocator({ stateRoot: root });
  const lease = await allocator.allocate({ canonicalFileKey: key, runId: "prepared-run", jobInstanceId: "10000000-0000-4000-8000-000000000001" });
  const claim = await claimFencingAdmission({ stateRoot: root, lease, randomUUID: () => "claim" });
  await rename(claim.claimedPath, path.join(root, key, "admission.lock"));
  const resumed = await claimFencingAdmission({ stateRoot: root, lease });
  assert.equal(resumed.lockPresent, true);
  await releaseClaimedAdmission(resumed);
  await finalizeClaimedRecovery(resumed);
});
