import { authorityDigest, validateAuthorizedPatch } from "./entry-action-policy.mjs";

export function createAuthoritySnapshot({ policy, profile, actionId, file, collection }) {
  const action = profile?.rules?.find((rule) => rule.id === actionId && rule.enabled === true);
  const target = action?.targets?.find((item) => item.file === file && item.collection === collection);
  if (!target || !Array.isArray(target.writableFields) || target.writableFields.length === 0 || typeof profile?.etag !== "string") authorityStale();
  let digest;
  try { digest = authorityDigest(policy); } catch { authorityStale(); }
  return Object.freeze({ authorityDigest: digest, automationProfileEtag: profile.etag, actionId, file, collection, writableFields: [...target.writableFields].sort() });
}

export function assertAuthorityCurrent({ snapshot, policy, profile, field, value }) {
  let currentDigest;
  try { currentDigest = authorityDigest(policy); } catch { authorityStale(); }
  if (!snapshot || snapshot.authorityDigest !== currentDigest || snapshot.automationProfileEtag !== profile?.etag) authorityStale();
  const action = profile.rules?.find((rule) => rule.id === snapshot.actionId && rule.enabled === true);
  const target = action?.targets?.find((item) => item.file === snapshot.file && item.collection === snapshot.collection);
  if (!target || !Array.isArray(target.writableFields) || !snapshot.writableFields.includes(field) || !target.writableFields.includes(field)) authorityStale();
  try { return validateAuthorizedPatch({ policy, file: snapshot.file, collection: snapshot.collection, field, value }); }
  catch { authorityStale(); }
}
function authorityStale() { throw Object.assign(new Error("Entry-action authority changed or was narrowed."), { code: "ENTRY_ACTION_AUTHORITY_STALE" }); }
