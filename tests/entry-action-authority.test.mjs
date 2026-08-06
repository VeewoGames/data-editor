import assert from "node:assert/strict";
import test from "node:test";
import { assertAuthorityCurrent, createAuthoritySnapshot } from "../src/entry-action-authority.mjs";

const profile = { etag: "\"profile-1\"", rules: [{
  id: "recheck", label: "Recheck", icon: "edit", enabled: true,
  targets: [{ file: "fixtures/items.json", collection: "items", textArtifact: { pathTemplate: "docs/items/{value}.md", sourceField: "item_id", allowCreate: true, allowUpdate: true, maxBytes: 4096 } }],
  payload: { includeRow: true, includeNeighbors: false },
}] };
const row = { item_id: "item_alpha", owner: "player", name: "Alpha", notes: "" };
const changes = [{ field: "name", beforeExists: true, before: "Alpha", afterExists: true, after: "Beta" }];
const textArtifact = { path: "docs/items/item_alpha.md", beforeExists: false, beforeDigest: null, afterContent: "# Alpha\n", afterDigest: "unused" };

test("authority snapshot derives scope entirely from the profile rule", () => {
  const snapshot = createAuthoritySnapshot({ profile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row });
  assert.deepEqual(snapshot.writableFields, ["item_id", "name", "notes", "owner"]);
  assert.equal(snapshot.textArtifact.path, "docs/items/item_alpha.md");
  assert.doesNotThrow(() => assertAuthorityCurrent({ snapshot, profile, changes, textArtifact, row }));
});

test("authority snapshot accepts a safe integer artifact source field", () => {
  const numericProfile = {
    ...profile,
    rules: [{
      ...profile.rules[0],
      targets: [{
        ...profile.rules[0].targets[0],
        textArtifact: {
          ...profile.rules[0].targets[0].textArtifact,
          sourceField: "id",
          pathTemplate: "docs/{value}.md",
        },
      }],
    }],
  };
  const snapshot = createAuthoritySnapshot({ profile: numericProfile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row: { ...row, id: 1026 } });
  assert.equal(snapshot.textArtifact.path, "docs/1026.md");
});

test("authority rejects changed target, rule authority, row identity and artifact path", () => {
  const snapshot = createAuthoritySnapshot({ profile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row });
  const stale = (error) => error?.code === "ENTRY_ACTION_PROFILE_STALE";
  assert.throws(() => assertAuthorityCurrent({ snapshot, profile: { ...profile, rules: [{ ...profile.rules[0], enabled: false }] }, changes, textArtifact, row }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, profile: { ...profile, rules: [{ ...profile.rules[0], targets: [] }] }, changes, textArtifact, row }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, profile, changes, textArtifact: { ...textArtifact, path: "docs/items/other.md" }, row }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, profile, changes, textArtifact, row: { ...row, item_id: "other" } }), stale);
});

test("authority uses a filename-safe deterministic artifact journal id", () => {
  const snapshot = createAuthoritySnapshot({
    profile,
    actionId: "recheck",
    file: "fixtures/items.json",
    collection: "items",
    row,
  });
  assert.match(snapshot.textArtifact.id, /^artifact_[0-9a-f]{64}$/);
  assert.equal(snapshot.textArtifact.id, createAuthoritySnapshot({
    profile,
    actionId: "recheck",
    file: "fixtures/items.json",
    collection: "items",
    row,
  }).textArtifact.id);
});

test("authority reports a missing required text artifact without claiming stale authority", () => {
  const snapshot = createAuthoritySnapshot({ profile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row });
  assert.throws(() => assertAuthorityCurrent({ snapshot, profile, changes, textArtifact: null, row }), {
    code: "ENTRY_ACTION_TEXT_ARTIFACT_REQUIRED",
  });
});
