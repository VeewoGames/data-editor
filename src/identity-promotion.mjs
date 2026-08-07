import { generatePersistentEntryId, readPersistentEntryId } from "./model/persistent-entry-id.mjs";

export class IdentityPromotionError extends Error {
  constructor(code, message) { super(message); this.name = "IdentityPromotionError"; this.code = code; }
}

/** Builds a durable embedded identity candidate without mutating the source row. */
export function buildEmbeddedIdentityPromotion({ row, policy, idempotencyKey, receipt = null, generateId = generatePersistentEntryId }) {
  if (!idempotencyKey || typeof idempotencyKey !== "string") throw new IdentityPromotionError("IDENTITY_PROMOTION_IDEMPOTENCY_REQUIRED", "Identity promotion requires an idempotency key.");
  if (receipt) {
    if (receipt.idempotencyKey !== idempotencyKey) throw new IdentityPromotionError("IDENTITY_PROMOTION_RECEIPT_CONFLICT", "Identity receipt belongs to another request.");
    return { replayed: true, durableId: receipt.durableId, row: structuredClone(receipt.row), receipt };
  }
  if (policy?.provider?.kind !== "embedded-v1" || typeof policy.provider.field !== "string" || !policy.provider.field) {
    throw new IdentityPromotionError("IDENTITY_PROMOTION_POLICY_REQUIRED", "A matching embedded-v1 identity policy is required.");
  }
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new IdentityPromotionError("IDENTITY_PROMOTION_ROW_INVALID", "Identity promotion requires an object row.");
  const field = policy.provider.field;
  const existingIdentity = typeof row[field] === "string" && row[field].trim() ? row[field].trim() : null;
  const durableId = existingIdentity ?? generateId();
  const nextRow = { ...structuredClone(row), [field]: durableId };
  return {
    replayed: false,
    identityCreated: existingIdentity === null,
    durableId,
    row: nextRow,
    receipt: { version: 1, idempotencyKey, policyId: policy.id, durableId, row: structuredClone(nextRow) },
  };
}

export function assertUniqueEmbeddedIdentity(rows, field, durableId) {
  const count = (rows ?? []).filter((row) => typeof row?.[field] === "string" && row[field].trim() === durableId).length;
  if (count > 1) throw new IdentityPromotionError("IDENTITY_PROMOTION_DUPLICATE", "Durable identity is duplicated in its collection.");
}
