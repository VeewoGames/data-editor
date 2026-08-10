import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { atomicWrite, exclusiveCreateLock } from "./atomic-file.mjs";

export const ENTRY_ACTION_GROUP_STAGES = Object.freeze([
  "group_intent",
  "artifact_committed",
  "source_committed",
  "verified",
  "result_published",
]);

export function createEntryActionGroupJournal({ directory }) {
  if (!path.isAbsolute(directory)) throw new TypeError("Entry action group journal directory must be absolute.");
  return {
    async begin(entry) {
      const intent = normalize(entry, "group_intent");
      try {
        await mkdir(directory, { recursive: true });
        await exclusiveCreateLock(file(directory, intent.idempotencyKey), `${JSON.stringify(intent, null, 2)}\n`);
        return intent;
      } catch (cause) {
        if (cause?.code !== "EEXIST") throw cause;
      }
      const existing = await readStage(directory, intent.idempotencyKey);
      assertSameGroup(existing, intent);
      return existing;
    },
    async advance(entry, stage) {
      const current = await readStage(directory, entry.idempotencyKey);
      assertSameGroup(current, normalize({ ...entry, stage: current.stage }));
      if (ENTRY_ACTION_GROUP_STAGES.indexOf(stage) !== ENTRY_ACTION_GROUP_STAGES.indexOf(current.stage) + 1) {
        fail("ENTRY_ACTION_GROUP_STAGE_INVALID");
      }
      const next = { ...current, stage, updatedAt: new Date().toISOString() };
      await atomicWrite(file(directory, next.idempotencyKey), `${JSON.stringify(next, null, 2)}\n`);
      return next;
    },
    read: (idempotencyKey) => readStage(directory, idempotencyKey),
    async readOptional(idempotencyKey) {
      try {
        return await readStage(directory, idempotencyKey);
      } catch (error) {
        if (error?.code === "ENTRY_ACTION_GROUP_JOURNAL_MISSING") return null;
        throw error;
      }
    },
    async findByRunId(runId) {
      if (!validId(runId)) fail("ENTRY_ACTION_GROUP_JOURNAL_INVALID");
      let names;
      try { names = await readdir(directory); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
      const matches = [];
      for (const name of names.filter((item) => item.endsWith(".json"))) {
        const entry = await readStage(directory, name.slice(0, -5));
        if (entry.runId === runId) matches.push(entry);
      }
      if (matches.length > 1) fail("ENTRY_ACTION_GROUP_JOURNAL_INVALID");
      return matches[0] ?? null;
    },
  };
}

async function readStage(directory, idempotencyKey) {
  try {
    return normalize(JSON.parse(await readFile(file(directory, idempotencyKey), "utf8")));
  } catch (cause) {
    if (cause?.code === "ENOENT") fail("ENTRY_ACTION_GROUP_JOURNAL_MISSING", cause);
    if (cause?.code?.startsWith("ENTRY_ACTION_GROUP_")) throw cause;
    fail("ENTRY_ACTION_GROUP_JOURNAL_INVALID", cause);
  }
}

function normalize(value, expectedStage = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !ENTRY_ACTION_GROUP_STAGES.includes(value.stage) || (expectedStage && value.stage !== expectedStage)
    || !validId(value.idempotencyKey) || !validId(value.runId) || !digest(value.proposalDigest)
    || !["proposal", "candidate_create"].includes(value.operation ?? "proposal")
    || !digest(value.ruleDigest)
    || !Array.isArray(value.evidence) || !digest(value.evidenceDigest) || digestText(JSON.stringify(value.evidence)) !== value.evidenceDigest
    || !validOwnership(value.ownership)
    || !validTarget(value.source, false, false) || !validTarget(value.artifact, true, true)
    || !validGroupId(value)
    || value.source.canonicalFileKey !== value.ownership.canonicalFileKey
    || !validSourceChild(value.source.childEntry, value)
    || !validArtifactChild(value.artifact.childEntry, value)) {
    fail("ENTRY_ACTION_GROUP_JOURNAL_INVALID");
  }
  if ((value.operation ?? "proposal") === "candidate_create" && (!digest(value.createContractDigest)
    || !validId(value.candidateId) || !validId(value.rowId) || !digest(value.semanticDigest)
    || !value.manifest || typeof value.manifest !== "object" || Array.isArray(value.manifest)
    || value.manifest.kind !== "candidate-create" || value.manifest.candidateId !== value.candidateId)) {
    fail("ENTRY_ACTION_GROUP_JOURNAL_INVALID");
  }
  return {
    ...structuredClone(value),
    operation: value.operation ?? "proposal",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
}

function validSourceChild(child, group) {
  const expectedSaveType = (group.operation ?? "proposal") === "candidate_create" ? "candidate_create_commit" : "proposal_commit";
  return child.saveType === expectedSaveType
    && child.canonicalFileKey === group.source.canonicalFileKey
    && child.runId === group.runId
    && child.proposalDigest === group.proposalDigest
    && child.requestDigest === group.proposalDigest
    && child.beforeDigest === group.source.beforeDigest
    && child.afterDigest === group.source.afterDigest;
}

function validGroupId(value) {
  return (value.operation ?? "proposal") === "candidate_create"
    ? /^candidate_create_[0-9a-f]{64}$/.test(value.idempotencyKey)
    : value.idempotencyKey === `group_${digestText(value.runId)}`;
}

function validArtifactChild(child, group) {
  return child.saveType === "text_artifact_commit"
    && child.canonicalFileKey === group.artifact.canonicalFileKey
    && child.runId === group.runId
    && child.requestDigest === group.proposalDigest
    && child.artifactPath === group.artifact.path
    && child.afterDigest === group.artifact.afterDigest;
}

function validOwnership(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && digest(value.canonicalFileKey) && validId(value.ownerToken) && digest(value.ownerHash)
    && Number.isSafeInteger(value.fencingToken) && value.fencingToken > 0
    && validId(value.jobInstanceId);
}

function validTarget(value, allowMissingBefore, requireBeforeContent) {
  return value && typeof value === "object" && !Array.isArray(value)
    && typeof value.path === "string" && value.path.length > 0
    && digest(value.canonicalFileKey) && validId(value.childEntry?.idempotencyKey)
    && typeof value.beforeExists === "boolean" && (allowMissingBefore || value.beforeExists === true)
    && (value.beforeExists ? digest(value.beforeDigest) : value.beforeDigest === null)
    && (!requireBeforeContent || (value.beforeExists ? typeof value.beforeContent === "string" && digestText(value.beforeContent) === value.beforeDigest : value.beforeContent === null))
    && value.afterExists === true && digest(value.afterDigest)
    && typeof value.afterContent === "string" && digestText(value.afterContent) === value.afterDigest
    && value.childEntry && typeof value.childEntry === "object" && !Array.isArray(value.childEntry);
}

function assertSameGroup(existing, requested) {
  if (stableJson(stripTimes(existing)) !== stableJson(stripTimes(requested))) {
    fail("ENTRY_ACTION_GROUP_IDEMPOTENCY_CONFLICT");
  }
}

function stripTimes(value) {
  const { stage: _stage, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = value;
  return rest;
}

function file(directory, id) {
  if (!validId(id)) fail("ENTRY_ACTION_GROUP_JOURNAL_INVALID");
  return path.join(directory, `${id}.json`);
}
function validId(value) { return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value); }
function digest(value) { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function digestText(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function fail(code, cause) { throw Object.assign(new Error(code), { code, cause }); }
