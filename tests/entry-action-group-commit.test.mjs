import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createCommitJournal } from "../src/commit-journal.mjs";
import { createDocumentCommitCoordinator } from "../src/document-commit-coordinator.mjs";
import { createAuthoritySnapshot } from "../src/entry-action-authority.mjs";
import {
  commitEntryActionGroup,
  createEntryActionGroupJournalEntry,
} from "../src/entry-action-group-commit.mjs";
import { createEntryActionGroupJournal } from "../src/entry-action-group-journal.mjs";
import { prepareEntryActionProposalCommit } from "../src/entry-action-proposal-commit.mjs";

const digest = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const etag = (value) => `"${digest(value)}"`;
const documentText = '[{"__entry_id":"row-1","item_id":"item_alpha","name":"Alpha","notes":""}]';
const row = { __entry_id: "row-1", item_id: "item_alpha", name: "Alpha", notes: "" };
const profile = {
  etag: '"profile"',
  rules: [{
    id: "rename",
    label: "Rename",
    icon: "wand",
    skill: "rename",
    enabled: true,
    includeCurrentEntry: true,
    includeSiblingEntries: false,
    targets: [{
      file: "data/items.json",
      collection: "$",
      textArtifact: { pathTemplate: "docs/items/{value}.md", sourceField: "item_id", allowCreate: true, allowUpdate: true, maxBytes: 4096 },
    }],
  }],
};
const snapshot = createAuthoritySnapshot({ profile, actionId: "rename", file: "data/items.json", collection: "$", row });
const lease = {
  canonicalFileKey: "a".repeat(64),
  runId: "10000000-0000-4000-8000-000000000001",
  fencingToken: 1,
  ownerToken: "20000000-0000-4000-8000-000000000002",
  ownerHash: "b".repeat(64),
  jobInstanceId: "30000000-0000-4000-8000-000000000003",
};
const afterArtifact = "# Alpha\n";
const proposal = {
  version: 3,
  runId: lease.runId,
  actionId: "rename",
  sourcePath: "data/items.json",
  canonicalFileKey: lease.canonicalFileKey,
  collectionPath: "$",
  rowId: "row-1",
  baseDocumentEtag: etag(documentText),
  ruleDigest: snapshot.ruleDigest,
  fencingToken: 1,
  changes: [
    { field: "name", beforeExists: true, before: "Alpha", afterExists: true, after: "Beta" },
    { field: "notes", beforeExists: true, before: "", afterExists: true, after: "Reviewed" },
  ],
  textArtifact: {
    id: "item-doc",
    path: "docs/items/item_alpha.md",
    beforeExists: false,
    beforeDigest: null,
    afterContent: afterArtifact,
    afterDigest: digest(afterArtifact),
  },
  summary: "rename",
};
const sourceIdentity = { canonicalFileKey: lease.canonicalFileKey };
const artifactIdentity = { canonicalFileKey: "c".repeat(64) };
const probeLease = () => ({ status: "owned", lease });

async function makeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-group-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const prepared = await prepareEntryActionProposalCommit({
    proposal,
    lease,
    authoritySnapshot: snapshot,
    profile,
    documentText,
    textArtifactCurrentText: null,
    probeLease,
  });
  const groupEntry = createEntryActionGroupJournalEntry({
    prepared,
    lease,
    documentText,
    sourceIdentity,
    artifactIdentity,
  });
  return {
    prepared,
    groupEntry,
    groupJournal: createEntryActionGroupJournal({ directory: path.join(root, "group") }),
    childJournal: createCommitJournal({ directory: path.join(root, "child") }),
    coordinator: createDocumentCommitCoordinator(),
    sourceIdentity,
    artifactIdentity,
    verifyOwnership: async (ownership) => {
      assert.equal(ownership.ownerToken, lease.ownerToken);
      assert.equal(ownership.ownerHash, lease.ownerHash);
      assert.equal(ownership.fencingToken, lease.fencingToken);
    },
    verifyAuthority: async (authority) => {
      assert.equal(authority.ruleDigest, snapshot.ruleDigest);
    },
    refreshIdentities: async () => ({
      source: sourceIdentity,
      artifact: artifactIdentity,
    }),
    publishResultIdempotently: async () => {},
  };
}

test("group commit writes and verifies both targets before publishing once", async (t) => {
  const fixture = await makeFixture(t);
  let source = documentText;
  let artifact = null;
  let published = 0;
  const options = {
    ...fixture,
    readSource: async () => source,
    writeSource: async (value) => { source = value; },
    readArtifact: async () => artifact,
    writeArtifact: async (value) => { artifact = value; },
    publishResultIdempotently: async () => { published += 1; },
  };
  const done = await commitEntryActionGroup(options);
  assert.equal(done.stage, "result_published");
  assert.equal(JSON.parse(source)[0].name, "Beta");
  assert.equal(artifact, afterArtifact);
  assert.equal(published, 1);

  await commitEntryActionGroup(options);
  assert.equal(published, 1);
});

test("group commit recovers forward after artifact and source crash windows", async (t) => {
  const fixture = await makeFixture(t);
  let source = documentText;
  let artifact = null;
  let sourceCrash = true;
  let artifactCrash = true;
  let published = 0;
  const options = {
    ...fixture,
    readSource: async () => source,
    writeSource: async (value) => {
      source = value;
      if (sourceCrash) {
        sourceCrash = false;
        throw new Error("source crash after durable write");
      }
    },
    readArtifact: async () => artifact,
    writeArtifact: async (value) => {
      artifact = value;
      if (artifactCrash) {
        artifactCrash = false;
        throw new Error("artifact crash after durable write");
      }
    },
    publishResultIdempotently: async () => { published += 1; },
  };
  await assert.rejects(() => commitEntryActionGroup(options), /artifact crash/);
  await assert.rejects(() => commitEntryActionGroup(options), /source crash/);
  const done = await commitEntryActionGroup(options);
  assert.equal(done.stage, "result_published");
  assert.equal(JSON.parse(source)[0].notes, "Reviewed");
  assert.equal(artifact, afterArtifact);
  assert.equal(published, 1);
});

test("group recovery fails closed when either target has external drift", async (t) => {
  const fixture = await makeFixture(t);
  let source = documentText;
  let artifact = null;
  let crash = true;
  const options = {
    ...fixture,
    readSource: async () => source,
    writeSource: async (value) => { source = value; },
    readArtifact: async () => artifact,
    writeArtifact: async (value) => {
      artifact = value;
      if (crash) {
        crash = false;
        throw new Error("artifact crash");
      }
    },
  };
  await assert.rejects(() => commitEntryActionGroup(options), /artifact crash/);
  source = '{"external":true}\n';
  await assert.rejects(() => commitEntryActionGroup(options), { code: "ENTRY_ACTION_GROUP_FAILED_NEEDS_RECOVERY" });
  assert.equal(artifact, afterArtifact);
});

test("group recovery rejects advanced phases without completed child evidence", async (t) => {
  const fixture = await makeFixture(t);
  let source = documentText;
  let artifact = null;
  await fixture.groupJournal.begin(fixture.groupEntry);
  artifact = afterArtifact;
  await fixture.groupJournal.advance(fixture.groupEntry, "artifact_committed");
  await assert.rejects(() => commitEntryActionGroup({
    ...fixture,
    readSource: async () => source,
    writeSource: async (value) => { source = value; },
    readArtifact: async () => artifact,
    writeArtifact: async (value) => { artifact = value; },
  }), { code: "ENTRY_ACTION_GROUP_CHILD_EVIDENCE_INVALID" });
  assert.equal(artifact, afterArtifact);
});

test("group commit resumes after process restart from journal payload alone", async (t) => {
  const fixture = await makeFixture(t);
  let source = documentText;
  let artifact = null;
  let crash = true;
  const firstOptions = {
    ...fixture,
    readSource: async () => source,
    writeSource: async (value) => { source = value; },
    readArtifact: async () => artifact,
    writeArtifact: async (value) => {
      artifact = value;
      if (crash) {
        crash = false;
        throw new Error("restart");
      }
    },
  };
  await assert.rejects(() => commitEntryActionGroup(firstOptions), /restart/);

  const recoveredEntry = await fixture.groupJournal.read(fixture.groupEntry.idempotencyKey);
  const done = await commitEntryActionGroup({
    coordinator: createDocumentCommitCoordinator(),
    groupJournal: fixture.groupJournal,
    childJournal: fixture.childJournal,
    groupEntry: recoveredEntry,
    sourceIdentity,
    artifactIdentity,
    verifyOwnership: fixture.verifyOwnership,
    verifyAuthority: fixture.verifyAuthority,
    refreshIdentities: fixture.refreshIdentities,
    publishResultIdempotently: async () => {},
    readSource: async () => source,
    writeSource: async (value) => { source = value; },
    readArtifact: async () => artifact,
    writeArtifact: async (value) => { artifact = value; },
  });
  assert.equal(done.stage, "result_published");
  assert.equal(JSON.parse(source)[0].name, "Beta");
  assert.equal(artifact, afterArtifact);
});

test("group publishing can be retried safely with the group idempotency key", async (t) => {
  const fixture = await makeFixture(t);
  let source = documentText;
  let artifact = null;
  const published = new Set();
  let crashAfterPublish = true;
  const options = {
    ...fixture,
    readSource: async () => source,
    writeSource: async (value) => { source = value; },
    readArtifact: async () => artifact,
    writeArtifact: async (value) => { artifact = value; },
    publishResultIdempotently: async () => {
      published.add(fixture.groupEntry.idempotencyKey);
      if (crashAfterPublish) {
        crashAfterPublish = false;
        throw new Error("publish crash");
      }
    },
  };
  await assert.rejects(() => commitEntryActionGroup(options), /publish crash/);
  const done = await commitEntryActionGroup(options);
  assert.equal(done.stage, "result_published");
  assert.deepEqual([...published], [fixture.groupEntry.idempotencyKey]);
});

test("authority is rechecked inside the multi-target lock before durable intent", async (t) => {
  const fixture = await makeFixture(t);
  let source = documentText;
  let artifact = null;
  let releaseBlocker;
  const blocker = fixture.coordinator.withIdentities([sourceIdentity, artifactIdentity], async () => {
    await new Promise((resolve) => { releaseBlocker = resolve; });
  });
  const attempt = commitEntryActionGroup({
    ...fixture,
    verifyAuthority: async () => {
      throw Object.assign(new Error("stale"), { code: "ENTRY_ACTION_AUTHORITY_STALE" });
    },
    readSource: async () => source,
    writeSource: async (value) => { source = value; },
    readArtifact: async () => artifact,
    writeArtifact: async (value) => { artifact = value; },
  });
  const rejection = assert.rejects(() => attempt, { code: "ENTRY_ACTION_AUTHORITY_STALE" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  releaseBlocker();
  await blocker;
  await rejection;
  assert.equal(source, documentText);
  assert.equal(artifact, null);
  assert.equal(await fixture.groupJournal.readOptional(fixture.groupEntry.idempotencyKey), null);
});

test("ownership loss after artifact commit blocks the source write", async (t) => {
  const fixture = await makeFixture(t);
  let source = documentText;
  let artifact = null;
  let probes = 0;
  await assert.rejects(() => commitEntryActionGroup({
    ...fixture,
    verifyOwnership: async () => {
      probes += 1;
      if (probes >= 3) throw Object.assign(new Error("ownership stale"), { code: "ENTRY_ACTION_ADMISSION_OWNERSHIP_CHANGED" });
    },
    readSource: async () => source,
    writeSource: async (value) => { source = value; },
    readArtifact: async () => artifact,
    writeArtifact: async (value) => { artifact = value; },
  }), { code: "ENTRY_ACTION_ADMISSION_OWNERSHIP_CHANGED" });
  assert.equal(artifact, afterArtifact);
  assert.equal(source, documentText);
  assert.equal((await fixture.groupJournal.read(fixture.groupEntry.idempotencyKey)).stage, "artifact_committed");
});

test("authority loss after artifact commit blocks the source write", async (t) => {
  const fixture = await makeFixture(t);
  let source = documentText;
  let artifact = null;
  let checks = 0;
  await assert.rejects(() => commitEntryActionGroup({
    ...fixture,
    verifyAuthority: async () => {
      checks += 1;
      if (checks >= 3) throw Object.assign(new Error("authority stale"), { code: "ENTRY_ACTION_AUTHORITY_STALE" });
    },
    readSource: async () => source,
    writeSource: async (value) => { source = value; },
    readArtifact: async () => artifact,
    writeArtifact: async (value) => { artifact = value; },
  }), { code: "ENTRY_ACTION_AUTHORITY_STALE" });
  assert.equal(artifact, afterArtifact);
  assert.equal(source, documentText);
  assert.equal((await fixture.groupJournal.read(fixture.groupEntry.idempotencyKey)).stage, "artifact_committed");
});

test("an exact recovery claim can finish a group after live ownership is lost", async (t) => {
  const fixture = await makeFixture(t);
  let source = documentText;
  let artifact = null;
  let liveProbes = 0;
  const options = {
    ...fixture,
    verifyOwnership: async () => {
      liveProbes += 1;
      if (liveProbes >= 3) throw Object.assign(new Error("ownership stale"), { code: "ENTRY_ACTION_ADMISSION_OWNERSHIP_CHANGED" });
    },
    readSource: async () => source,
    writeSource: async (value) => { source = value; },
    readArtifact: async () => artifact,
    writeArtifact: async (value) => { artifact = value; },
  };
  await assert.rejects(() => commitEntryActionGroup(options), { code: "ENTRY_ACTION_ADMISSION_OWNERSHIP_CHANGED" });
  const recovered = await commitEntryActionGroup({
    ...options,
    verifyOwnership: async (ownership) => {
      assert.equal(ownership.ownerToken, lease.ownerToken);
      assert.equal(ownership.ownerHash, lease.ownerHash);
    },
  });
  assert.equal(recovered.stage, "result_published");
  assert.equal(artifact, afterArtifact);
  assert.equal(JSON.parse(source)[0].name, "Beta");
});

test("completed replay returns durable outcome after later legitimate edits", async (t) => {
  const fixture = await makeFixture(t);
  let source = documentText;
  let artifact = null;
  const options = {
    ...fixture,
    readSource: async () => source,
    writeSource: async (value) => { source = value; },
    readArtifact: async () => artifact,
    writeArtifact: async (value) => { artifact = value; },
  };
  await commitEntryActionGroup(options);
  source = '{"later":"edit"}\n';
  artifact = "# Later edit\n";
  const replay = await commitEntryActionGroup(options);
  assert.equal(replay.stage, "result_published");
  assert.equal(source, '{"later":"edit"}\n');
  assert.equal(artifact, "# Later edit\n");
});

test("new group detects stale before-state without creating recovery intent", async (t) => {
  const fixture = await makeFixture(t);
  let source = '{"external":true}\n';
  let artifact = null;
  await assert.rejects(() => commitEntryActionGroup({
    ...fixture,
    readSource: async () => source,
    writeSource: async (value) => { source = value; },
    readArtifact: async () => artifact,
    writeArtifact: async (value) => { artifact = value; },
  }), { code: "ENTRY_ACTION_GROUP_CONFLICTED" });
  assert.equal(await fixture.groupJournal.readOptional(fixture.groupEntry.idempotencyKey), null);
  assert.equal(artifact, null);
});
