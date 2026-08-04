import crypto from "node:crypto";
import { ruleAuthorityDigest } from "./automation-profile.mjs";

export function createAuthoritySnapshot({ profile, actionId, file, collection, row = null }) {
  const action = profile?.rules?.find((rule) => rule.id === actionId && rule.enabled === true);
  const target = action?.targets?.find((item) => item.file === file && item.collection === collection);
  if (!target || !row || typeof row !== "object" || Array.isArray(row)) targetNotConfigured();
  const textArtifact = target.textArtifact ? createTextArtifact(target.textArtifact, row, actionId, file, collection) : null;
  const ruleDigest = ruleAuthorityDigest(action);
  return Object.freeze({
    ruleDigest, actionId, file, collection,
    writableFields: Object.keys(row).sort(), textArtifact,
  });
}

export function assertAuthorityCurrent({ snapshot, profile, changes, textArtifact, row }) {
  const action = profile?.rules?.find((rule) => rule.id === snapshot?.actionId && rule.enabled === true);
  const target = action?.targets?.find((item) => item.file === snapshot?.file && item.collection === snapshot?.collection);
  if (!snapshot || !target || ruleAuthorityDigest(action) !== snapshot.ruleDigest) authorityStale();
  if (!Array.isArray(changes) || changes.length === 0) authorityStale();
  for (const change of changes) {
    if (!snapshot.writableFields.includes(change.field) || !Object.hasOwn(row, change.field) || change.after === undefined) authorityStale();
  }
  assertTextArtifact(snapshot.textArtifact, target.textArtifact ?? null, textArtifact, row);
  return { fieldRules: changes.map(() => ({ uniqueScope: "none" })), textArtifactRule: null };
}

function createTextArtifact(rule, row, actionId, file, collection) {
  const sourceValue = row?.[rule.sourceField];
  if (typeof sourceValue !== "string" || !/^[a-zA-Z0-9_-]+$/.test(sourceValue)) authorityStale();
  // Journal IDs must be portable filename-safe values, not user-facing paths.
  const id = `artifact_${crypto.createHash("sha256").update(`${actionId}\u0000${file}\u0000${collection}`, "utf8").digest("hex")}`;
  return Object.freeze({ id, path: rule.pathTemplate.replace("{value}", sourceValue), sourceField: rule.sourceField, sourceValue, ...rule });
}
function assertTextArtifact(snapshot, rule, proposal, row) {
  if (snapshot !== null && proposal === null) textArtifactRequired();
  if ((snapshot === null) !== (proposal === null) || (snapshot === null) !== (rule === null)) authorityStale();
  if (proposal === null) return;
  if (proposal.path !== snapshot.path || row?.[snapshot.sourceField] !== snapshot.sourceValue) authorityStale();
  if (proposal.beforeExists ? !snapshot.allowUpdate : !snapshot.allowCreate) authorityStale();
  if (typeof proposal.afterContent !== "string" || Buffer.byteLength(proposal.afterContent, "utf8") > snapshot.maxBytes) authorityStale();
}
function targetNotConfigured() { throw Object.assign(new Error("Entry action target is not configured."), { code: "ENTRY_ACTION_TARGET_NOT_CONFIGURED" }); }
function authorityStale() { throw Object.assign(new Error("Entry action rule changed or entry is stale."), { code: "ENTRY_ACTION_PROFILE_STALE" }); }
function textArtifactRequired() { throw Object.assign(new Error("Entry action requires its configured text artifact."), { code: "ENTRY_ACTION_TEXT_ARTIFACT_REQUIRED" }); }
