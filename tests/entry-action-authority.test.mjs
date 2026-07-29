import assert from "node:assert/strict";
import test from "node:test";
import { assertAuthorityCurrent, createAuthoritySnapshot } from "../src/entry-action-authority.mjs";

const policy = {
  version: 3,
  targets: [{
    file: "fixtures/items.json",
    collection: "items",
    rowMatch: { owner: ["player"] },
  }],
  textArtifacts: [{
    id: "item-doc",
    pathTemplate: "docs/items/{value}.md",
    sourceField: "item_id",
    allowCreate: true,
    allowUpdate: true,
    maxBytes: 4096,
  }],
};
const profile = {
  etag: "\"profile-1\"",
  rules: [{
    id: "recheck",
    enabled: true,
    targets: [{
      file: "fixtures/items.json",
      collection: "items",
      textArtifactId: "item-doc",
    }],
  }],
};
const row = { item_id: "item_alpha", owner: "player", name: "Alpha", notes: "" };
const changes = [
  { field: "name", beforeExists: true, before: "Alpha", afterExists: true, after: "Beta" },
  { field: "notes", beforeExists: true, before: "", afterExists: true, after: "Reviewed" },
];
const textArtifact = {
  id: "item-doc",
  path: "docs/items/item_alpha.md",
  beforeExists: false,
  beforeDigest: null,
  afterContent: "# Alpha\n",
  afterDigest: "unused-by-authority",
};

test("authority snapshot exposes every current row field to the selected skill", () => {
  const snapshot = createAuthoritySnapshot({ policy, profile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row });
  assert.deepEqual(snapshot.writableFields, ["item_id", "name", "notes", "owner"]);
  assert.deepEqual(snapshot.textArtifact, {
    id: "item-doc",
    path: "docs/items/item_alpha.md",
    sourceField: "item_id",
    sourceValue: "item_alpha",
  });
  assert.doesNotThrow(() => assertAuthorityCurrent({ snapshot, policy, profile, changes, textArtifact, row }));
});

test("authority snapshot fails closed on profile, policy, target, row or artifact changes", () => {
  const snapshot = createAuthoritySnapshot({ policy, profile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row });
  const stale = (error) => error?.code === "ENTRY_ACTION_AUTHORITY_STALE";
  assert.throws(() => assertAuthorityCurrent({ snapshot, policy, profile: { ...profile, etag: "\"profile-2\"" }, changes, textArtifact, row }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, policy: { ...policy, targets: [] }, profile, changes, textArtifact, row }), stale);
  assert.throws(() => createAuthoritySnapshot({ policy: { ...policy, targets: [] }, profile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, policy, profile: { ...profile, rules: [{ ...profile.rules[0], targets: [] }] }, changes, textArtifact, row }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, policy, profile, changes, textArtifact, row: { ...row, item_id: "other" } }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, policy, profile, changes, textArtifact: { ...textArtifact, path: "docs/items/other.md" }, row }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, policy, profile, changes, textArtifact: null, row }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, policy, profile, changes, textArtifact, row: { ...row, owner: "enemy" } }), stale);
  assert.throws(() => createAuthoritySnapshot({ policy, profile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row: { ...row, owner: "enemy" } }), stale);
});
