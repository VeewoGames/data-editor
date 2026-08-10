import assert from "node:assert/strict";
import test from "node:test";
import { assertAuthorityCurrent, createAuthoritySnapshot } from "../src/entry-action-authority.mjs";

const profile = { etag: "\"profile-1\"", rules: [{
  id: "recheck", label: "Recheck", icon: "edit", enabled: true,
  targets: [{ file: "fixtures/items.json", collection: "items", textArtifact: {} }],
  payload: { includeRow: true, includeNeighbors: false },
}] };
const row = { item_id: "item_alpha", owner: "player", name: "Alpha", notes: "" };
const changes = [{ field: "name", beforeExists: true, before: "Alpha", afterExists: true, after: "Beta" }];
const textArtifact = { path: "docs/items/item_alpha.md", beforeExists: false, beforeDigest: null, afterContent: "# Alpha\n", afterDigest: "unused" };
const documentTarget = { primaryKeyField: "item_id", documentRoot: "docs/items", sourceValue: "item_alpha", path: "docs/items/item_alpha.md" };

test("authority snapshot derives scope entirely from the profile rule", () => {
  const snapshot = createAuthoritySnapshot({ profile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row, documentTarget });
  assert.deepEqual(snapshot.writableFields, ["item_id", "name", "notes", "owner"]);
  assert.equal(snapshot.textArtifact.path, "docs/items/item_alpha.md");
  assert.equal(snapshot.textArtifact.maxBytes, 262144);
  assert.equal(snapshot.textArtifact.allowCreate, true);
  assert.equal(snapshot.textArtifact.allowUpdate, true);
  assert.doesNotThrow(() => assertAuthorityCurrent({ snapshot, profile, changes, textArtifact, row, documentTarget }));
});

test("authority excludes designer note fields from every automated proposal", () => {
  const noteRow = { ...row, dev_note: "designer requirement", dev_notes: "designer note" };
  const snapshot = createAuthoritySnapshot({ profile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row: noteRow, documentTarget });
  const stale = (error) => error?.code === "ENTRY_ACTION_PROFILE_STALE";

  assert.doesNotMatch(snapshot.writableFields.join(","), /(^|,)(dev_note|dev_notes)(,|$)/);
  assert.throws(() => assertAuthorityCurrent({
    snapshot,
    profile,
    changes: [{ field: "dev_note", beforeExists: true, before: "designer requirement", afterExists: true, after: "changed" }],
    textArtifact,
    row: noteRow,
    documentTarget,
  }), stale);
});

test("authority snapshot accepts a safe integer primary key", () => {
  const numericTarget = { primaryKeyField: "id", documentRoot: "docs", sourceValue: "1026", path: "docs/1026.md" };
  const snapshot = createAuthoritySnapshot({ profile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row: { ...row, id: 1026 }, documentTarget: numericTarget });
  assert.equal(snapshot.textArtifact.path, "docs/1026.md");
  assert.doesNotThrow(() => assertAuthorityCurrent({
    snapshot,
    profile,
    changes,
    textArtifact: { ...textArtifact, path: "docs/1026.md" },
    row: { ...row, id: 1026 },
    documentTarget: numericTarget,
  }));
});

test("authority rejects changed target, rule authority, row identity and artifact path", () => {
  const snapshot = createAuthoritySnapshot({ profile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row, documentTarget });
  const stale = (error) => error?.code === "ENTRY_ACTION_PROFILE_STALE";
  assert.throws(() => assertAuthorityCurrent({ snapshot, profile: { ...profile, rules: [{ ...profile.rules[0], enabled: false }] }, changes, textArtifact, row, documentTarget }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, profile: { ...profile, rules: [{ ...profile.rules[0], targets: [] }] }, changes, textArtifact, row, documentTarget }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, profile, changes, textArtifact: { ...textArtifact, path: "docs/items/other.md" }, row, documentTarget }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, profile, changes, textArtifact, row: { ...row, item_id: "other" }, documentTarget }), stale);
  assert.throws(() => assertAuthorityCurrent({ snapshot, profile, changes, textArtifact, row, documentTarget: { ...documentTarget, documentRoot: "docs/other", path: "docs/other/item_alpha.md" } }), stale);
});

test("authority uses a filename-safe deterministic artifact journal id", () => {
  const snapshot = createAuthoritySnapshot({
    profile,
    actionId: "recheck",
    file: "fixtures/items.json",
    collection: "items",
    row, documentTarget,
  });
  assert.match(snapshot.textArtifact.id, /^artifact_[0-9a-f]{64}$/);
  assert.equal(snapshot.textArtifact.id, createAuthoritySnapshot({
    profile,
    actionId: "recheck",
    file: "fixtures/items.json",
    collection: "items",
    row, documentTarget,
  }).textArtifact.id);
});

test("authority reports a missing required text artifact without claiming stale authority", () => {
  const snapshot = createAuthoritySnapshot({ profile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row, documentTarget });
  assert.throws(() => assertAuthorityCurrent({ snapshot, profile, changes, textArtifact: null, row, documentTarget }), {
    code: "ENTRY_ACTION_TEXT_ARTIFACT_REQUIRED",
  });
});

test("authority enforces contract predicate, allowlist, transition and digest", () => {
  const contractedProfile = { ...profile, rules: [{ ...profile.rules[0], execution: { kind: "project-skill", resultPolicy: "proposal" }, contractId: "fixture.review.v1" }] };
  const contract = { contractId: "fixture.review.v1", digest: "c".repeat(64), resultPolicy: "proposal", predicate: { all: [{ field: "owner", op: "eq", value: "player" }] }, writableFields: ["name"], legalTransitions: [] };
  const snapshot = createAuthoritySnapshot({ profile: contractedProfile, actionId: "recheck", file: "fixtures/items.json", collection: "items", row, documentTarget, contract });
  assert.deepEqual(snapshot.writableFields, ["name"]);
  assert.doesNotThrow(() => assertAuthorityCurrent({ snapshot, profile: contractedProfile, changes, textArtifact, row, documentTarget, contract }));
  assert.throws(() => assertAuthorityCurrent({ snapshot, profile: contractedProfile, changes: [{ ...changes[0], field: "notes" }], textArtifact, row, documentTarget, contract }), { code: "ENTRY_ACTION_FIELD_FORBIDDEN" });
  assert.throws(() => assertAuthorityCurrent({ snapshot, profile: contractedProfile, changes, textArtifact, row, documentTarget, contract: { ...contract, digest: "d".repeat(64) } }), { code: "ENTRY_ACTION_PROFILE_STALE" });
});
