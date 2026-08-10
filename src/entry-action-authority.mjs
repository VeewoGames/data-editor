import crypto from "node:crypto";
import { defaultTextArtifactPolicy, ruleAuthorityDigest } from "./automation-profile.mjs";
import { assertEntryActionChanges, assertEntryActionPredicate } from "./entry-action-contracts.mjs";

// Designer-authored requirements and notes are read-only inputs for every automated entry action.
const HUMAN_NOTE_FIELDS = new Set(["dev_note", "dev_notes"]);

export function createAuthoritySnapshot({ profile, actionId, file, collection, row = null, documentTarget = null, contract = null }) {
  const action = profile?.rules?.find((rule) => rule.id === actionId && rule.enabled === true);
  const target = action?.targets?.find((item) => item.file === file && item.collection === collection);
  if (!target || !row || typeof row !== "object" || Array.isArray(row)) targetNotConfigured();
  const textArtifact = target.textArtifact ? createTextArtifact(target.textArtifact, documentTarget, row, actionId, file, collection) : null;
  if (contract) {
    if (contract.contractId !== action.contractId || contract.resultPolicy !== action.execution?.resultPolicy) authorityStale();
    assertEntryActionPredicate(contract.predicate, row);
  }
  const ruleDigest = ruleAuthorityDigest(action);
  const writableFields = (contract?.writableFields ?? Object.keys(row)).filter((field) => !HUMAN_NOTE_FIELDS.has(field)).sort();
  return Object.freeze({
    ruleDigest, actionId, file, collection,
    writableFields, contractId: contract?.contractId ?? action.contractId ?? null, contractDigest: contract?.digest ?? null, textArtifact,
  });
}

export function assertAuthorityCurrent({ snapshot, profile, changes, textArtifact, row, documentTarget = null, contract = null }) {
  const action = profile?.rules?.find((rule) => rule.id === snapshot?.actionId && rule.enabled === true);
  const target = action?.targets?.find((item) => item.file === snapshot?.file && item.collection === snapshot?.collection);
  if (!snapshot || !target || ruleAuthorityDigest(action) !== snapshot.ruleDigest) authorityStale();
  if (contract) {
    if (contract.contractId !== snapshot.contractId || contract.digest !== snapshot.contractDigest || contract.resultPolicy !== action.execution?.resultPolicy) authorityStale();
    assertEntryActionPredicate(contract.predicate, row);
    assertEntryActionChanges(contract, changes, row);
  }
  if (!Array.isArray(changes) || changes.length === 0) authorityStale();
  for (const change of changes) {
    if (!snapshot.writableFields.includes(change.field) || !Object.hasOwn(row, change.field) || change.after === undefined) authorityStale();
  }
  assertTextArtifact(snapshot.textArtifact, target.textArtifact ?? null, textArtifact, row, documentTarget);
  return { fieldRules: changes.map(() => ({ uniqueScope: "none" })), textArtifactRule: null };
}

function createTextArtifact(rule, documentTarget, row, actionId, file, collection) {
  if (!documentTarget || typeof documentTarget !== "object") authorityStale();
  const sourceValue = normalizeArtifactSourceValue(row?.[documentTarget.primaryKeyField]);
  if (!sourceValue || sourceValue !== documentTarget.sourceValue || !/^[a-zA-Z0-9_-]+$/.test(sourceValue)) authorityStale();
  // Journal IDs must be portable filename-safe values, not user-facing paths.
  const id = `artifact_${crypto.createHash("sha256").update(`${actionId}\u0000${file}\u0000${collection}`, "utf8").digest("hex")}`;
  return Object.freeze({
    id,
    path: documentTarget.path,
    primaryKeyField: documentTarget.primaryKeyField,
    documentRoot: documentTarget.documentRoot,
    sourceValue,
    ...defaultTextArtifactPolicy,
  });
}
function assertTextArtifact(snapshot, rule, proposal, row, documentTarget) {
  if (snapshot !== null && proposal === null) textArtifactRequired();
  if ((snapshot === null) !== (proposal === null) || (snapshot === null) !== (rule === null)) authorityStale();
  if (proposal === null) return;
  if (!documentTarget
    || documentTarget.primaryKeyField !== snapshot.primaryKeyField
    || documentTarget.documentRoot !== snapshot.documentRoot
    || documentTarget.path !== snapshot.path
    || proposal.path !== snapshot.path
    || normalizeArtifactSourceValue(row?.[snapshot.primaryKeyField]) !== snapshot.sourceValue) authorityStale();
  if (proposal.beforeExists ? !snapshot.allowUpdate : !snapshot.allowCreate) authorityStale();
  if (typeof proposal.afterContent !== "string" || Buffer.byteLength(proposal.afterContent, "utf8") > snapshot.maxBytes) authorityStale();
}
function normalizeArtifactSourceValue(value) {
  if (typeof value === "string") return value;
  return Number.isSafeInteger(value) ? String(value) : null;
}
function targetNotConfigured() { throw Object.assign(new Error("Entry action target is not configured."), { code: "ENTRY_ACTION_TARGET_NOT_CONFIGURED" }); }
function authorityStale() { throw Object.assign(new Error("Entry action rule changed or entry is stale."), { code: "ENTRY_ACTION_PROFILE_STALE" }); }
function textArtifactRequired() { throw Object.assign(new Error("Entry action requires its configured text artifact."), { code: "ENTRY_ACTION_TEXT_ARTIFACT_REQUIRED" }); }
