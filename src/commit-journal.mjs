import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { atomicWrite, exclusiveCreateLock } from "./atomic-file.mjs";

export const COMMIT_JOURNAL_STAGES = Object.freeze(["commit_intent", "source_replaced", "verified", "result_published"]);

/** Durable, per logical-save evidence. Entries are immutable except for forward stage movement. */
export function createCommitJournal({ directory }) {
  if (!path.isAbsolute(directory)) throw new TypeError("Commit journal directory must be absolute.");
  return {
    async begin(entry) {
      const intent = normalize(entry, "commit_intent");
      try {
        await mkdir(directory, { recursive: true });
        await exclusiveCreateLock(file(directory, intent.idempotencyKey), `${JSON.stringify(intent, null, 2)}\n`);
        return intent;
      } catch (cause) {
        if (cause?.code !== "EEXIST") throw cause;
      }
      const existing = await readStage(directory, intent.idempotencyKey);
      assertSameLogicalSave(existing, intent);
      return existing;
    },
    async advance(entry, stage) {
      const current = await readStage(directory, entry.idempotencyKey);
      assertSameLogicalSave(current, normalize({ ...entry, stage: current.stage }));
      if (COMMIT_JOURNAL_STAGES.indexOf(stage) !== COMMIT_JOURNAL_STAGES.indexOf(current.stage) + 1) {
        throw journalError("COMMIT_JOURNAL_STAGE_INVALID");
      }
      return writeStage(directory, {
        ...current,
        stage,
        // A normal commit becomes terminal only after publication. Any earlier
        // stage, including a failed post-replace verifier, remains recoverable.
        ...(Object.hasOwn(current, "recovery_pending") ? { recovery_pending: stage !== "result_published" } : {}),
        updatedAt: new Date().toISOString(),
      });
    },
    read: (idempotencyKey) => readStage(directory, idempotencyKey),
  };
}

async function writeStage(directory, entry) {
  await mkdir(directory, { recursive: true });
  await atomicWrite(file(directory, entry.idempotencyKey), `${JSON.stringify(entry, null, 2)}\n`);
  return entry;
}

async function readStage(directory, idempotencyKey) {
  try {
    return normalize(JSON.parse(await readFile(file(directory, idempotencyKey), "utf8")));
  } catch (cause) {
    if (cause?.code === "ENOENT") throw journalError("COMMIT_JOURNAL_MISSING", cause);
    if (cause?.code?.startsWith("COMMIT_JOURNAL_")) throw cause;
    throw journalError("COMMIT_JOURNAL_INVALID", cause);
  }
}

function normalize(value, expectedStage = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !COMMIT_JOURNAL_STAGES.includes(value.stage) || (expectedStage && value.stage !== expectedStage)
    || !validId(value.idempotencyKey) || !["document_save", "proposal_commit", "text_artifact_commit"].includes(value.saveType)
    || !digest(value.canonicalFileKey) || typeof value.baseEtag !== "string" || typeof value.newEtag !== "string"
    || !digest(value.beforeDigest) || !digest(value.afterDigest) || !digest(value.requestDigest)
    || (Object.hasOwn(value, "recovery_pending") && typeof value.recovery_pending !== "boolean")) {
    throw journalError("COMMIT_JOURNAL_INVALID");
  }
  if (value.saveType === "proposal_commit" && (!validId(value.runId) || !validId(value.ownerToken)
    || !Number.isInteger(value.fencingToken) || value.fencingToken < 0 || !validId(value.rowId)
    || !digest(value.proposalDigest) || !validProposalChanges(value.changes))) {
    throw journalError("COMMIT_JOURNAL_INVALID");
  }
  if (value.saveType === "text_artifact_commit" && (!validId(value.runId) || !validId(value.artifactId)
    || typeof value.artifactPath !== "string" || value.artifactPath.length === 0)) {
    throw journalError("COMMIT_JOURNAL_INVALID");
  }
  return { ...value, createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(), updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString() };
}

function assertSameLogicalSave(existing, requested) {
  for (const key of ["idempotencyKey", "saveType", "canonicalFileKey", "baseEtag", "newEtag", "beforeDigest", "afterDigest", "requestDigest", "runId", "ownerToken", "fencingToken", "rowId", "proposalDigest", "artifactId", "artifactPath"]) {
    if (!Object.is(existing[key] ?? null, requested[key] ?? null)) throw journalError("COMMIT_JOURNAL_IDEMPOTENCY_CONFLICT");
  }
}

function file(directory, id) { if (!validId(id)) throw journalError("COMMIT_JOURNAL_INVALID"); return path.join(directory, `${id}.json`); }
function validId(value) { return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value); }
function digest(value) { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function validProposalChanges(value) {
  return Array.isArray(value) && value.length > 0 && value.every((change) => (
    change && typeof change === "object" && !Array.isArray(change)
    && typeof change.field === "string" && change.field.length > 0
    && typeof change.beforeExists === "boolean" && typeof change.afterExists === "boolean"
    && Object.hasOwn(change, "before") && Object.hasOwn(change, "after")
  ));
}
export function journalError(code, cause) { return Object.assign(new Error(code), { code, cause }); }
