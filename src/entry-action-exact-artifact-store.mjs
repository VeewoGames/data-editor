import crypto from "node:crypto";
import path from "node:path";
import { link, mkdir, readFile, rm } from "node:fs/promises";
import { atomicWrite } from "./atomic-file.mjs";
import { resolveInsideRoot } from "./project-context.mjs";

const ID = /^[A-Za-z0-9._-]+$/;
const DIGEST = /^[0-9a-f]{64}$/;

export async function publishExactArtifact({ projectContext, artifactId, content, humanNotes = null }) {
  assertId(artifactId); if (typeof content !== "string") fail("EXACT_ARTIFACT_CONTENT_INVALID");
  const directory = root(projectContext); await mkdir(directory, { recursive: true });
  const artifactDigest = digest(content);
  const artifactPath = path.join(directory, `${artifactId}.json`);
  const boundNotes = humanNotes === null ? null : bindHumanNotes(humanNotes);
  // The immutable receipt is the publication point and is deliberately last.
  // A content file without this receipt is never an admissible artifact.
  const receipt = { version: 1, artifactId, artifactDigest, humanNotes: boundNotes };
  const receiptPath = path.join(directory, `${artifactId}.receipt.json`);
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  // Both immutable files are linked into place only after their complete bytes
  // are durable. Receipt publication remains last and needs no persistent lock.
  await publishImmutableFile(artifactPath, content);
  await publishImmutableFile(receiptPath, serialized);
  return { artifactId, artifactDigest };
}

export async function readExactArtifact({ projectContext, artifactId }) {
  assertId(artifactId); const directory = root(projectContext);
  let content; let receipt;
  try {
    content = await readFile(path.join(directory, `${artifactId}.json`), "utf8");
    receipt = JSON.parse(await readFile(path.join(directory, `${artifactId}.receipt.json`), "utf8"));
  } catch (error) { if (error?.code === "ENOENT" || error instanceof SyntaxError) fail("EXACT_ARTIFACT_RECEIPT_INVALID"); throw error; }
  if (!plain(receipt) || Object.keys(receipt).sort().join(",") !== "artifactDigest,artifactId,humanNotes,version" || receipt.version !== 1 || receipt.artifactId !== artifactId || !DIGEST.test(receipt.artifactDigest) || receipt.artifactDigest !== digest(content)) fail("EXACT_ARTIFACT_RECEIPT_INVALID");
  let humanNotes = null;
  if (receipt.humanNotes !== null) {
    const note = receipt.humanNotes;
    if (!plain(note) || Object.keys(note).sort().join(",") !== "field,text,textDigest" || typeof note.field !== "string" || !ID.test(note.field) || typeof note.text !== "string" || !DIGEST.test(note.textDigest) || note.textDigest !== digest(note.text)) fail("EXACT_ARTIFACT_RECEIPT_INVALID");
    humanNotes = { field: note.field, text: note.text, digest: note.textDigest };
  }
  return { content, humanNotes };
}

function root(context) { return resolveInsideRoot(context.projectRoot, path.join(context.runtimeDir, "entry-action-artifacts")); }
function assertId(value) { if (typeof value !== "string" || !ID.test(value)) fail("EXACT_ARTIFACT_REQUEST_INVALID"); }
function digest(value) { return crypto.createHash("sha256").update(value, "utf8").digest("hex"); }
function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function bindHumanNotes(value) { if (!plain(value) || Object.keys(value).sort().join(",") !== "field,text" || typeof value.field !== "string" || !ID.test(value.field) || typeof value.text !== "string") fail("EXACT_ARTIFACT_HUMAN_NOTES_INVALID"); return { field: value.field, text: value.text, textDigest: digest(value.text) }; }
async function publishImmutableFile(targetPath, content) {
  const temporaryPath = `${targetPath}.${crypto.randomUUID()}.publish`;
  try {
    await atomicWrite(temporaryPath, content);
    try { await link(temporaryPath, targetPath); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await readFile(targetPath, "utf8") !== content) fail("EXACT_ARTIFACT_IDEMPOTENCY_CONFLICT");
    }
  } finally { await rm(temporaryPath, { force: true }).catch(() => {}); }
}
function fail(code) { throw Object.assign(new Error(code), { code, status: 409 }); }
