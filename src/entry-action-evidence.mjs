const DIGEST = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9._-]+$/;
const MAX_ITEMS = 256;

export function validateEntryActionEvidence(value) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) invalid();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).sort().join(",") !== "digest,kind,ref"
      || typeof item.kind !== "string" || !ID.test(item.kind)
      || typeof item.ref !== "string" || !item.ref
      || typeof item.digest !== "string" || !DIGEST.test(item.digest)) invalid();
  }
  return structuredClone(value);
}

function invalid() {
  throw Object.assign(new Error("Entry-action evidence schema is invalid."), {
    code: "ENTRY_ACTION_EVIDENCE_INVALID",
  });
}
