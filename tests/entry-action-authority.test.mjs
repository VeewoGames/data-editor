import assert from "node:assert/strict";
import test from "node:test";
import { assertAuthorityCurrent, createAuthoritySnapshot } from "../src/entry-action-authority.mjs";

const policy = { version: 1, targets: [{ file: "fixtures/items.json", collection: "items", writableFields: { name: { type: "string", nullable: false, uniqueScope: "none", validator: "non_empty_string" } } }] };
const profile = { etag: "\"profile-1\"", rules: [{ id: "recheck", enabled: true, targets: [{ file: "fixtures/items.json", collection: "items", writableFields: ["name"] }] }] };
test("authority snapshot allows only unchanged intersection", () => {
  const snapshot = createAuthoritySnapshot({ policy, profile, actionId: "recheck", file: "fixtures/items.json", collection: "items" });
  assert.doesNotThrow(() => assertAuthorityCurrent({ snapshot, policy, profile, field: "name", value: "Beta" }));
});
test("authority snapshot fails closed on profile, policy, target or permission changes", () => {
  const snapshot = createAuthoritySnapshot({ policy, profile, actionId: "recheck", file: "fixtures/items.json", collection: "items" });
  const stale = (error) => error?.code === "ENTRY_ACTION_AUTHORITY_STALE";
  assert.throws(() => assertAuthorityCurrent({ snapshot, policy, profile: { ...profile, etag: "\"profile-2\"" }, field: "name", value: "Beta" }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, policy: { ...policy, targets: [] }, profile, field: "name", value: "Beta" }), stale);
  assert.throws(() => createAuthoritySnapshot({ policy: { ...policy, targets: [] }, profile, actionId: "recheck", file: "fixtures/items.json", collection: "items" }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, policy, profile: { ...profile, rules: [{ ...profile.rules[0], targets: [] }] }, field: "name", value: "Beta" }), stale);
});
