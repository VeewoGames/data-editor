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

// The final document digest is server-owned. A model cannot reliably produce it,
// so contracts that require one document proof receive it after the proposal is bound.
export function completeEntryActionEvidence({ contract, evidence, textArtifact }) {
  const normalized = validateEntryActionEvidence(evidence);
  const policy = contract?.evidencePolicy;
  if (!policy?.required || normalized.length > 0 || policy.minItems !== 1
    || !Array.isArray(policy.allowedKinds) || policy.allowedKinds.length !== 1
    || !textArtifact || typeof textArtifact.path !== "string" || !textArtifact.path
    || typeof textArtifact.afterDigest !== "string" || !DIGEST.test(textArtifact.afterDigest)) {
    return normalized;
  }
  return [{
    kind: policy.allowedKinds[0],
    ref: textArtifact.path,
    digest: textArtifact.afterDigest,
  }];
}

function invalid() {
  throw Object.assign(new Error("Entry-action evidence schema is invalid."), {
    code: "ENTRY_ACTION_EVIDENCE_INVALID",
  });
}
