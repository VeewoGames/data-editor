import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFencingAllocator, FencingLockError } from "../src/fencing-lock.mjs";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

test("same canonical key allocates serial, never reuses fencing tokens", async (t) => {
  const fixture = await makeFixture(t);
  const first = await fixture.allocator.allocate(request(KEY_A, "one"));
  assert.equal(first.fencingToken, 1);
  await assert.rejects(() => fixture.allocator.allocate(request(KEY_A, "blocked")), hasCode("ENTRY_ACTION_ADMISSION_BUSY"));
  await fixture.allocator.persistOwnedEvidence(first, ownedEvidence(first));
  await fixture.allocator.release(first);
  const second = await fixture.allocator.allocate(request(KEY_A, "two"));
  // The rejected contender had already durably allocated token 2; it is never reused.
  assert.equal(second.fencingToken, 3);
});

test("different canonical keys isolate admission", async (t) => {
  const fixture = await makeFixture(t);
  const [first, second] = await Promise.all([
    fixture.allocator.allocate(request(KEY_A, "a")),
    fixture.allocator.allocate(request(KEY_B, "b")),
  ]);
  assert.equal(first.fencingToken, 1);
  assert.equal(second.fencingToken, 1);
});

test("the fixed claimable admission directory is empty and owned by its durable head", async (t) => {
  const fixture = await makeFixture(t);
  const lease = await fixture.allocator.allocate(request(KEY_A, "empty-lock"));
  const lockDirectory = path.join(fixture.root, KEY_A, "admission.lock");
  assert.deepEqual(await readdir(lockDirectory), []);
  const admissionHead = JSON.parse(await readFile(path.join(fixture.root, KEY_A, "admission-head.json"), "utf8"));
  assert.equal(admissionHead.ownerToken, lease.ownerToken);
  assert.equal(admissionHead.ownerHash, lease.ownerHash);
});

test("broken or missing durable chain files fail closed", async (t) => {
  const fixture = await makeFixture(t);
  const lease = await fixture.allocator.allocate(request(KEY_A, "first"));
  const keyRoot = path.join(fixture.root, KEY_A);
  await fixture.allocator.persistOwnedEvidence(lease, ownedEvidence(lease));
  await fixture.allocator.release(lease);
  await unlink(path.join(keyRoot, "head.json"));
  await assert.rejects(() => fixture.allocator.allocate(request(KEY_A, "missing-head")), hasCode("ENTRY_ACTION_FENCING_INTEGRITY_UNAVAILABLE"));
  await writeFile(path.join(keyRoot, "head.json"), "{}\n");
  await assert.rejects(() => fixture.allocator.probe({ canonicalFileKey: KEY_A }), hasCode("ENTRY_ACTION_FENCING_INTEGRITY_UNAVAILABLE"));
  await writeFile(path.join(keyRoot, "tail-anchor.json"), "{}\n");
  await assert.rejects(() => fixture.allocator.probe({ canonicalFileKey: KEY_A }), hasCode("ENTRY_ACTION_FENCING_INTEGRITY_UNAVAILABLE"));
  await writeFile(path.join(keyRoot, "records", "1.json"), "{}\n");
  await assert.rejects(() => fixture.allocator.probe({ canonicalFileKey: KEY_A }), hasCode("ENTRY_ACTION_FENCING_INTEGRITY_UNAVAILABLE"));
});

test("allocation persisted before admission conflict is not reused after crash-shaped failure", async (t) => {
  const fixture = await makeFixture(t);
  const keyRoot = path.join(fixture.root, KEY_A);
  await mkdir(path.join(keyRoot, "admission.lock"), { recursive: true });
  await assert.rejects(() => fixture.allocator.allocate(request(KEY_A, "crashed-before-admission")), hasCode("ENTRY_ACTION_ADMISSION_BUSY"));
  const firstRecord = JSON.parse(await readFile(path.join(keyRoot, "records", "1.json"), "utf8"));
  assert.equal(firstRecord.fencingToken, 1);
  await rm(path.join(keyRoot, "admission.lock"), { recursive: true });
  const next = await fixture.allocator.allocate(request(KEY_A, "next"));
  assert.equal(next.fencingToken, 2);
});

test("one complete immutable tail record beyond old anchor/head is reanchored before next allocation", async (t) => {
  const fixture = await makeFixture(t);
  const first = await fixture.allocator.allocate(request(KEY_A, "first"));
  await fixture.allocator.persistOwnedEvidence(first, ownedEvidence(first));
  await fixture.allocator.release(first);
  const keyRoot = path.join(fixture.root, KEY_A);
  const predecessor = JSON.parse(await readFile(path.join(keyRoot, "records", "1.json"), "utf8"));
  await writeFile(path.join(keyRoot, "records", "2.json"), `${JSON.stringify(completeRecord(KEY_A, 2, predecessor.recordHash))}\n`);
  const next = await fixture.allocator.allocate(request(KEY_A, "reanchored"));
  assert.equal(next.fencingToken, 3);
  assert.equal(JSON.parse(await readFile(path.join(keyRoot, "tail-anchor.json"), "utf8")).fencingToken, 3);
  assert.equal(JSON.parse(await readFile(path.join(keyRoot, "head.json"), "utf8")).fencingToken, 3);
});

test("malformed or more-than-one unanchored tail record stays fail closed", async (t) => {
  const malformed = await makeFixture(t);
  const malformedLease = await malformed.allocator.allocate(request(KEY_A, "malformed-base"));
  await malformed.allocator.persistOwnedEvidence(malformedLease, ownedEvidence(malformedLease));
  await malformed.allocator.release(malformedLease);
  await writeFile(path.join(malformed.root, KEY_A, "records", "2.json"), "{}\n");
  await assert.rejects(() => malformed.allocator.allocate(request(KEY_A, "malformed")), hasCode("ENTRY_ACTION_FENCING_INTEGRITY_UNAVAILABLE"));

  const multiple = await makeFixture(t);
  const multipleLease = await multiple.allocator.allocate(request(KEY_A, "multiple-base"));
  await multiple.allocator.persistOwnedEvidence(multipleLease, ownedEvidence(multipleLease));
  await multiple.allocator.release(multipleLease);
  const keyRoot = path.join(multiple.root, KEY_A);
  const one = JSON.parse(await readFile(path.join(keyRoot, "records", "1.json"), "utf8"));
  const two = completeRecord(KEY_A, 2, one.recordHash);
  await writeFile(path.join(keyRoot, "records", "2.json"), `${JSON.stringify(two)}\n`);
  await writeFile(path.join(keyRoot, "records", "3.json"), `${JSON.stringify(completeRecord(KEY_A, 3, two.recordHash))}\n`);
  await assert.rejects(() => multiple.allocator.allocate(request(KEY_A, "multiple")), hasCode("ENTRY_ACTION_FENCING_INTEGRITY_UNAVAILABLE"));
});

test("stale owner cannot update or release a later owner", async (t) => {
  const fixture = await makeFixture(t);
  const oldLease = await fixture.allocator.allocate(request(KEY_A, "old"));
  await fixture.allocator.persistOwnedEvidence(oldLease, ownedEvidence(oldLease));
  await fixture.allocator.release(oldLease);
  const current = await fixture.allocator.allocate(request(KEY_A, "current"));
  await assert.rejects(() => fixture.allocator.heartbeat(oldLease), hasCode("ENTRY_ACTION_ADMISSION_OWNERSHIP_CHANGED"));
  await assert.rejects(() => fixture.allocator.markEvidencePending(oldLease), hasCode("ENTRY_ACTION_ADMISSION_OWNERSHIP_CHANGED"));
  await assert.rejects(() => fixture.allocator.release(oldLease), hasCode("ENTRY_ACTION_ADMISSION_OWNERSHIP_CHANGED"));
  await assert.rejects(() => readFile(path.join(fixture.root, KEY_A, "heartbeats", oldLease.ownerToken, "1.json")), { code: "ENOENT" });
  assert.equal((await fixture.allocator.probe({ canonicalFileKey: KEY_A })).lease.ownerToken, current.ownerToken);
});

test("legacy evidence_pending is nonterminal and cannot release admission", async (t) => {
  const fixture = await makeFixture(t);
  const lease = await fixture.allocator.allocate(request(KEY_A, "phase"));
  assert.equal((await fixture.allocator.probe({ canonicalFileKey: KEY_A })).phase, "launching");
  const firstHeartbeat = await fixture.allocator.heartbeat(lease);
  assert.equal(firstHeartbeat.heartbeatSequence, 1);
  assert.equal(JSON.parse(await readFile(path.join(fixture.root, KEY_A, "heartbeats", lease.ownerToken, "1.json"), "utf8")).phase, "launching");
  await assert.rejects(() => fixture.allocator.release(lease), hasCode("ENTRY_ACTION_EVIDENCE_PHASE_INVALID"));
  const pending = await fixture.allocator.markEvidencePending(lease);
  assert.equal(pending.phase, "evidence_pending");
  await assert.rejects(() => fixture.allocator.markEvidencePending(lease), hasCode("ENTRY_ACTION_EVIDENCE_PHASE_INVALID"));
  assert.equal((await fixture.allocator.probe({ canonicalFileKey: KEY_A })).phase, "evidence_pending");
  assert.equal((await fixture.allocator.heartbeat(lease)).heartbeatSequence, 2);
  await assert.rejects(() => fixture.allocator.release(lease), hasCode("ENTRY_ACTION_EVIDENCE_PHASE_INVALID"));
});

test("supervisor-owned evidence is immutable, ownership-checked, and advances phase", async (t) => {
  const fixture = await makeFixture(t);
  const lease = await fixture.allocator.allocate(request(KEY_A, "owned"));
  await assert.rejects(() => fixture.allocator.release(lease), hasCode("ENTRY_ACTION_EVIDENCE_PHASE_INVALID"));
  const persisted = await fixture.allocator.persistOwnedEvidence(lease, ownedEvidence(lease));
  assert.equal(persisted.phase, "evidence_persisted");
  assert.equal((await fixture.allocator.probe({ canonicalFileKey: KEY_A })).phase, "evidence_persisted");
  const stored = JSON.parse(await readFile(path.join(fixture.root, KEY_A, "owned-evidence", `${lease.ownerToken}.json`), "utf8"));
  assert.equal(stored.child.creationFileTime, "133000000000000000");
  await fixture.allocator.release(lease);
});

test("owned evidence rejects invalid FILETIME, job mismatch, and stale ownership without persistence", async (t) => {
  const fixture = await makeFixture(t);
  const lease = await fixture.allocator.allocate(request(KEY_A, "invalid-owned"));
  await assert.rejects(() => fixture.allocator.persistOwnedEvidence(lease, { ...ownedEvidence(lease), child: { pid: "12", creationFileTime: "12.5" } }), hasCode("ENTRY_ACTION_OWNED_EVIDENCE_INVALID"));
  await assert.rejects(() => fixture.allocator.persistOwnedEvidence(lease, { ...ownedEvidence(lease), jobInstanceId: "10000000-0000-4000-8000-000000000099" }), hasCode("ENTRY_ACTION_OWNED_EVIDENCE_INVALID"));
  await assert.rejects(() => fixture.allocator.release(lease), hasCode("ENTRY_ACTION_EVIDENCE_PHASE_INVALID"));
  await fixture.allocator.persistOwnedEvidence(lease, ownedEvidence(lease));
  await fixture.allocator.release(lease);
  const later = await fixture.allocator.allocate(request(KEY_A, "later-owned"));
  await assert.rejects(() => fixture.allocator.persistOwnedEvidence(lease, ownedEvidence(lease)), hasCode("ENTRY_ACTION_ADMISSION_OWNERSHIP_CHANGED"));
  assert.equal(JSON.parse(await readFile(path.join(fixture.root, KEY_A, "owned-evidence", `${lease.ownerToken}.json`), "utf8")).ownerToken, lease.ownerToken);
  await fixture.allocator.persistOwnedEvidence(later, ownedEvidence(later));
});

test("allocation rejects a non-UUID jobInstanceId", async (t) => {
  const fixture = await makeFixture(t);
  await assert.rejects(() => fixture.allocator.allocate({ canonicalFileKey: KEY_A, runId: "invalid-job", jobInstanceId: "not-a-uuid" }), /jobInstanceId must be a UUID/);
});

async function makeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-fencing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let serial = 0;
  return {
    root,
    allocator: createFencingAllocator({
      stateRoot: root,
      now: () => `2026-07-27T00:00:00.${String(serial).padStart(3, "0")}Z`,
      randomUUID: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
    }),
  };
}

function request(canonicalFileKey, suffix) {
  return { canonicalFileKey, runId: `run-${suffix}`, jobInstanceId: "10000000-0000-4000-8000-000000000001" };
}

function completeRecord(canonicalFileKey, fencingToken, previousRecordHash) {
  const withoutHash = { protocolVersion: 1, canonicalFileKey, fencingToken, runId: `recovered-${fencingToken}`, jobInstanceId: "10000000-0000-4000-8000-000000000002", issuedAt: "2026-07-27T00:00:00.000Z", previousRecordHash };
  return { ...withoutHash, recordHash: crypto.createHash("sha256").update(JSON.stringify(withoutHash)).digest("hex") };
}

function ownedEvidence(lease) {
  return { jobInstanceId: lease.jobInstanceId, helper: { pid: "42", creationFileTime: "132999999999999999" }, child: { pid: "43", creationFileTime: "133000000000000000" } };
}

function hasCode(code) {
  return (error) => error instanceof FencingLockError && error.code === code;
}
