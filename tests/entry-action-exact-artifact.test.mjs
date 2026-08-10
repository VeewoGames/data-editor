import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { submitExactArtifact } from "../src/entry-action-exact-artifact.mjs";
import { publishExactArtifact, readExactArtifact } from "../src/entry-action-exact-artifact-store.mjs";
import { createProjectContext } from "../src/project-context.mjs";

const content = '{"kind":"candidate-create"}';
const digest = crypto.createHash("sha256").update(content, "utf8").digest("hex");
const request = { projectId: "fixture", actionId: "create-item", target: { sourcePath: "data/items.json", collectionPath: "items" }, artifactId: "artifact-1", artifactDigest: digest };

test("exact artifact submission always creates and admits a fresh server run", async () => {
  const observed = [];
  const result = await submitExactArtifact(request, {
    createRunId: () => "10000000-0000-4000-8000-000000000001",
    readArtifact: async () => ({ content }),
    admitFreshRun: async (value) => { observed.push(value); return { runId: value.runId, authoritySnapshot: {}, lease: {}, baseDocumentEtag: '"etag"' }; },
    submitAdmittedResult: async (value) => value,
  });
  assert.equal(result.runId, "10000000-0000-4000-8000-000000000001");
  assert.equal(observed[0].artifactDigest, digest);
});

test("exact artifact submission rejects digest drift before admission", async () => {
  let admitted = false;
  await assert.rejects(() => submitExactArtifact({ ...request, artifactDigest: "0".repeat(64) }, {
    readArtifact: async () => ({ content }), admitFreshRun: async () => { admitted = true; }, submitAdmittedResult: async () => {},
  }), { code: "EXACT_ARTIFACT_DIGEST_MISMATCH" });
  assert.equal(admitted, false);
});

test("exact artifact receipt is mandatory, immutable, and records explicit absent humanNotes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "exact-artifact-receipt-")); t.after(() => rm(root, { recursive: true, force: true }));
  const projectContext = createProjectContext(root);
  await publishExactArtifact({ projectContext, artifactId: "complete", content, humanNotes: null });
  assert.deepEqual(await readExactArtifact({ projectContext, artifactId: "complete" }), { content, humanNotes: null });
  await publishExactArtifact({ projectContext, artifactId: "complete", content, humanNotes: null });
  await Promise.all(Array.from({ length: 4 }, () => publishExactArtifact({ projectContext, artifactId: "concurrent", content, humanNotes: { field: "dev_note", text: "same" } })));
  assert.deepEqual((await readExactArtifact({ projectContext, artifactId: "concurrent" })).humanNotes, { field: "dev_note", text: "same", digest: crypto.createHash("sha256").update("same").digest("hex") });
  await assert.rejects(() => publishExactArtifact({ projectContext, artifactId: "complete", content, humanNotes: { field: "dev_note", text: "late mutation" } }), { code: "EXACT_ARTIFACT_IDEMPOTENCY_CONFLICT" });
});

test("artifact content without its final receipt and a deleted receipt both fail closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "exact-artifact-incomplete-")); t.after(() => rm(root, { recursive: true, force: true }));
  const projectContext = createProjectContext(root); const directory = path.join(root, ".data-editor", "runtime", "entry-action-artifacts"); await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "partial.json"), content, "utf8");
  await assert.rejects(() => readExactArtifact({ projectContext, artifactId: "partial" }), { code: "EXACT_ARTIFACT_RECEIPT_INVALID" });
  // A legacy orphan lock has no authority in the no-lock protocol. Replaying
  // the same immutable content completes the missing receipt safely.
  await mkdir(path.join(directory, "partial.publish.lock"));
  await publishExactArtifact({ projectContext, artifactId: "partial", content, humanNotes: null });
  assert.deepEqual(await readExactArtifact({ projectContext, artifactId: "partial" }), { content, humanNotes: null });
  await writeFile(path.join(directory, "conflict.json"), content, "utf8");
  await mkdir(path.join(directory, "conflict.publish.lock"));
  await assert.rejects(() => publishExactArtifact({ projectContext, artifactId: "conflict", content: `${content}\n`, humanNotes: null }), { code: "EXACT_ARTIFACT_IDEMPOTENCY_CONFLICT" });
  await assert.rejects(() => readExactArtifact({ projectContext, artifactId: "conflict" }), { code: "EXACT_ARTIFACT_RECEIPT_INVALID" });
  await writeFile(path.join(directory, "incomplete.json"), content, "utf8"); await writeFile(path.join(directory, "incomplete.receipt.json"), '{"version":1}', "utf8");
  await assert.rejects(() => readExactArtifact({ projectContext, artifactId: "incomplete" }), { code: "EXACT_ARTIFACT_RECEIPT_INVALID" });
  await publishExactArtifact({ projectContext, artifactId: "with-note", content, humanNotes: { field: "dev_note", text: "bound" } });
  await rm(path.join(directory, "with-note.receipt.json"));
  await assert.rejects(() => readExactArtifact({ projectContext, artifactId: "with-note" }), { code: "EXACT_ARTIFACT_RECEIPT_INVALID" });
});
