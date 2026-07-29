import { authorityDigest, validateAuthorizedPatch, validateAuthorizedRow, validateAuthorizedTextArtifact } from "./entry-action-policy.mjs";

export function createAuthoritySnapshot({ policy, profile, actionId, file, collection, row = null }) {
  const action = profile?.rules?.find((rule) => rule.id === actionId && rule.enabled === true);
  const target = action?.targets?.find((item) => item.file === file && item.collection === collection);
  if (!target || !row || typeof row !== "object" || Array.isArray(row) || typeof profile?.etag !== "string") authorityStale();
  let digest;
  let textArtifact = null;
  try {
    digest = authorityDigest(policy);
    validateAuthorizedRow({ policy, file, collection, row });
    if (target.textArtifactId != null) {
      const artifact = policy.textArtifacts.find((item) => item.id === target.textArtifactId);
      const sourceValue = row?.[artifact?.sourceField];
      if (!artifact || typeof sourceValue !== "string") authorityStale();
      textArtifact = Object.freeze({
        id: artifact.id,
        path: artifact.pathTemplate.replace("{value}", sourceValue),
        sourceField: artifact.sourceField,
        sourceValue,
      });
    }
  } catch { authorityStale(); }
  return Object.freeze({
    authorityDigest: digest,
    automationProfileEtag: profile.etag,
    actionId,
    file,
    collection,
    writableFields: Object.keys(row).sort(),
    textArtifact,
  });
}

export function assertAuthorityCurrent({ snapshot, policy, profile, changes, textArtifact, row }) {
  let currentDigest;
  try { currentDigest = authorityDigest(policy); } catch { authorityStale(); }
  if (!snapshot || snapshot.authorityDigest !== currentDigest || snapshot.automationProfileEtag !== profile?.etag) authorityStale();
  const action = profile.rules?.find((rule) => rule.id === snapshot.actionId && rule.enabled === true);
  const target = action?.targets?.find((item) => item.file === snapshot.file && item.collection === snapshot.collection);
  if (!target || !Array.isArray(changes) || changes.length === 0) authorityStale();
  try {
    validateAuthorizedRow({ policy, file: snapshot.file, collection: snapshot.collection, row });
    const fieldRules = changes.map((change) => {
      if (!snapshot.writableFields.includes(change.field) || !Object.hasOwn(row, change.field)) authorityStale();
      return validateAuthorizedPatch({ policy, file: snapshot.file, collection: snapshot.collection, field: change.field, value: change.after });
    });
    let textArtifactRule = null;
    if ((snapshot.textArtifact === null) !== (textArtifact === null)) authorityStale();
    if (textArtifact !== null) {
      if (!snapshot.textArtifact || target.textArtifactId !== snapshot.textArtifact.id
        || textArtifact.id !== snapshot.textArtifact.id || textArtifact.path !== snapshot.textArtifact.path
        || row?.[snapshot.textArtifact.sourceField] !== snapshot.textArtifact.sourceValue) authorityStale();
      textArtifactRule = validateAuthorizedTextArtifact({
        policy,
        artifactId: textArtifact.id,
        path: textArtifact.path,
        sourceValue: snapshot.textArtifact.sourceValue,
        beforeExists: textArtifact.beforeExists,
        afterContent: textArtifact.afterContent,
      });
    }
    return { fieldRules, textArtifactRule };
  }
  catch { authorityStale(); }
}
function authorityStale() { throw Object.assign(new Error("Entry-action authority changed or was narrowed."), { code: "ENTRY_ACTION_AUTHORITY_STALE" }); }
