import assert from "node:assert/strict";
import test from "node:test";
import { createEntryActionCreateAdapterRegistry } from "../src/entry-action-create-adapter-registry.mjs";

const contract = {
  serverOwnedFields: ["id"],
  serverDefaults: {},
  createAdapter: { id: "next-integer-v1", config: { field: "id", startAt: 1 } },
};

test("registered next-integer adapter allocates only the contract-selected field", async () => {
  const registry = createEntryActionCreateAdapterRegistry();
  assert.deepEqual(await registry.allocateServerFields({ fields: ["id"], rows: [{ id: 1 }, { id: 4 }], row: {}, contract }), { id: 5 });
  assert.deepEqual(await registry.allocateServerFields({ fields: ["id"], rows: [], row: {}, contract }), { id: 1 });
});

test("missing registrations and invalid source values fail closed", async () => {
  const registry = createEntryActionCreateAdapterRegistry();
  await assert.rejects(() => registry.allocateServerFields({ fields: ["id"], rows: [], row: {}, contract: { ...contract, createAdapter: { id: "missing-v1", config: {} } } }), { code: "CANDIDATE_CREATE_SERVER_ALLOCATION_UNAVAILABLE" });
  await assert.rejects(() => registry.allocateServerFields({ fields: ["id"], rows: [{ id: "one" }], row: {}, contract }), { code: "CANDIDATE_CREATE_SERVER_ALLOCATION_INVALID" });
  await assert.rejects(() => registry.allocateServerFields({ fields: ["other"], rows: [], row: {}, contract }), { code: "CANDIDATE_CREATE_SERVER_ALLOCATION_INVALID" });
});
