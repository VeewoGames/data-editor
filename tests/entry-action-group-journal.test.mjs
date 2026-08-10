import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createEntryActionGroupJournal } from "../src/entry-action-group-journal.mjs";

const digest = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const runId = "10000000-0000-4000-8000-000000000001";
const proposalDigest = "b".repeat(64);
const sourceBeforeDigest = "e".repeat(64);
const sourceAfterDigest = digest("source");
const artifactAfterDigest = digest("artifact");
const entry = {
  idempotencyKey: `group_${digest(runId)}`,
  runId,
  proposalDigest,
  ruleDigest: "4".repeat(64),
  evidence: [],
  evidenceDigest: digest("[]"),
  ownership: {
    canonicalFileKey: "c".repeat(64),
    ownerToken: "20000000-0000-4000-8000-000000000002",
    ownerHash: "5".repeat(64),
    fencingToken: 1,
    jobInstanceId: "30000000-0000-4000-8000-000000000003",
  },
  source: {
    path: "data/items.json",
    canonicalFileKey: "c".repeat(64),
    childEntry: {
      idempotencyKey: `proposal_${"d".repeat(64)}`,
      saveType: "proposal_commit",
      canonicalFileKey: "c".repeat(64),
      runId,
      proposalDigest,
      requestDigest: proposalDigest,
      beforeDigest: sourceBeforeDigest,
      afterDigest: sourceAfterDigest,
    },
    beforeExists: true,
    beforeDigest: sourceBeforeDigest,
    afterExists: true,
    afterDigest: sourceAfterDigest,
    afterContent: "source",
  },
  artifact: {
    path: "docs/items/item.md",
    canonicalFileKey: "1".repeat(64),
    childEntry: {
      idempotencyKey: `artifact_${"2".repeat(64)}`,
      saveType: "text_artifact_commit",
      canonicalFileKey: "1".repeat(64),
      runId,
      requestDigest: proposalDigest,
      artifactPath: "docs/items/item.md",
      afterDigest: artifactAfterDigest,
    },
    beforeExists: false,
    beforeDigest: null,
    beforeContent: null,
    afterExists: true,
    afterDigest: artifactAfterDigest,
    afterContent: "artifact",
  },
  stage: "group_intent",
};

test("group journal persists forward-only phases and rejects idempotency conflicts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "group-journal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journal = createEntryActionGroupJournal({ directory: root });
  await journal.begin(entry);
  await journal.advance(entry, "artifact_committed");
  await assert.rejects(() => journal.advance(entry, "verified"), { code: "ENTRY_ACTION_GROUP_STAGE_INVALID" });
  await journal.advance(entry, "source_committed");
  await journal.advance(entry, "verified");
  const done = await journal.advance(entry, "result_published");
  assert.equal(done.stage, "result_published");
  const conflictingDigest = "9".repeat(64);
  await assert.rejects(() => journal.begin({
    ...entry,
    proposalDigest: conflictingDigest,
    source: {
      ...entry.source,
      childEntry: {
        ...entry.source.childEntry,
        proposalDigest: conflictingDigest,
        requestDigest: conflictingDigest,
      },
    },
    artifact: {
      ...entry.artifact,
      childEntry: {
        ...entry.artifact.childEntry,
        requestDigest: conflictingDigest,
      },
    },
  }), { code: "ENTRY_ACTION_GROUP_IDEMPOTENCY_CONFLICT" });
});
