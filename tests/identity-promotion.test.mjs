import assert from "node:assert/strict";
import test from "node:test";
import { buildEmbeddedIdentityPromotion } from "../src/identity-promotion.mjs";

const policy = { id: "items-identity", provider: { kind: "embedded-v1", field: "__entry_id" } };

test("embedded identity promotion is explicit, non-mutating, and receipt-idempotent", () => {
  const source = { item_id: "potion" };
  const first = buildEmbeddedIdentityPromotion({ row: source, policy, idempotencyKey: "promotion-1", generateId: () => "DURABLE-1" });
  assert.equal(source.__entry_id, undefined);
  assert.equal(first.row.__entry_id, "DURABLE-1");
  const replay = buildEmbeddedIdentityPromotion({ row: { item_id: "changed" }, policy, idempotencyKey: "promotion-1", receipt: first.receipt });
  assert.equal(replay.replayed, true);
  assert.equal(replay.durableId, "DURABLE-1");
  assert.deepEqual(replay.row, first.row);
});
