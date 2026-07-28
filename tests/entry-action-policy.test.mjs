import assert from "node:assert/strict";
import test from "node:test";
import { authorityDigest, EntryActionPolicyError, validateAuthorizedPatch, validateEntryActionPolicy } from "../src/entry-action-policy.mjs";

const policy = { version: 1, targets: [{ file: "fixtures/items.json", collection: "items", writableFields: { name: { type: "string", nullable: false, uniqueScope: "collection", validator: "non_empty_string" }, notes: { type: "string", nullable: true, uniqueScope: "none", validator: "any" } } }] };
const code = (value) => (error) => error instanceof EntryActionPolicyError && error.code === value;

test("policy validates fixture authority and has a stable digest", () => {
  const normalized = validateEntryActionPolicy(policy);
  assert.match(authorityDigest(normalized), /^[0-9a-f]{64}$/);
  assert.equal(authorityDigest(normalized), authorityDigest(JSON.parse(JSON.stringify(normalized))));
});
test("policy fails closed for missing targets, fields, types, nulls and validators", () => {
  assert.throws(() => validateEntryActionPolicy({ ...policy, ignored: true }), code("ENTRY_ACTION_POLICY_INVALID"));
  assert.throws(() => validateEntryActionPolicy({ version: 1, targets: [{ ...policy.targets[0], writableFields: { name: { ...policy.targets[0].writableFields.name, ignored: true } } }] }), code("ENTRY_ACTION_POLICY_INVALID"));
  assert.throws(() => validateAuthorizedPatch({ policy, file: "other.json", collection: "items", field: "name", value: "Ok" }), code("ENTRY_ACTION_POLICY_TARGET_DENIED"));
  assert.throws(() => validateAuthorizedPatch({ policy, file: "fixtures/items.json", collection: "items", field: "other", value: "Ok" }), code("ENTRY_ACTION_POLICY_FIELD_DENIED"));
  assert.throws(() => validateAuthorizedPatch({ policy, file: "fixtures/items.json", collection: "items", field: "name", value: null }), code("ENTRY_ACTION_POLICY_VALUE_DENIED"));
  assert.throws(() => validateAuthorizedPatch({ policy, file: "fixtures/items.json", collection: "items", field: "name", value: " " }), code("ENTRY_ACTION_POLICY_VALUE_DENIED"));
  assert.throws(() => validateAuthorizedPatch({ policy, file: "fixtures/items.json", collection: "items", field: "name", value: 3 }), code("ENTRY_ACTION_POLICY_VALUE_DENIED"));
});
