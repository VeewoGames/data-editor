import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { completeIdentityPromotion, createIdentityPromotionIntent, createIdentityPromotionJournal } from "../src/identity-promotion-journal.mjs";

test("identity promotion journal persists recovery_pending intent and immutable receipt", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-identity-journal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journal = createIdentityPromotionJournal({ directory: root });
  const intent = createIdentityPromotionIntent({ idempotencyKey: "promotion_12345", durableId: "ID-1" });
  await journal.write(intent);
  assert.equal((await journal.read("promotion_12345")).recovery_pending, true);
  await journal.write(completeIdentityPromotion(intent, { durableId: "ID-1" }));
  assert.deepEqual((await journal.read("promotion_12345")).receipt, { durableId: "ID-1" });
  assert.equal((await journal.list()).length, 1);
});
