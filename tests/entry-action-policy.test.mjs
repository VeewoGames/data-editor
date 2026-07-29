import assert from "node:assert/strict";
import test from "node:test";
import {
  authorityDigest,
  EntryActionPolicyError,
  validateAuthorizedPatch,
  validateAuthorizedRow,
  validateAuthorizedTextArtifact,
  validateEntryActionPolicy,
} from "../src/entry-action-policy.mjs";

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
const code = (value) => (error) => error instanceof EntryActionPolicyError && error.code === value;

test("policy validates row and text artifact authority with a stable digest", () => {
  const normalized = validateEntryActionPolicy(policy);
  assert.match(authorityDigest(normalized), /^[0-9a-f]{64}$/);
  assert.equal(authorityDigest(normalized), authorityDigest(JSON.parse(JSON.stringify(normalized))));
  assert.doesNotThrow(() => validateAuthorizedRow({
    policy,
    file: "fixtures/items.json",
    collection: "items",
    row: { owner: "player" },
  }));
  assert.doesNotThrow(() => validateAuthorizedTextArtifact({
    policy,
    artifactId: "item-doc",
    path: "docs/items/item_alpha.md",
    sourceValue: "item_alpha",
    beforeExists: false,
    afterContent: "# Alpha\n",
  }));
});

test("policy fails closed for invalid row and text artifact authority", () => {
  assert.throws(() => validateEntryActionPolicy({ ...policy, ignored: true }), code("ENTRY_ACTION_POLICY_INVALID"));
  assert.throws(() => validateEntryActionPolicy({ ...policy, version: 2 }), code("ENTRY_ACTION_POLICY_INVALID"));
  assert.throws(() => validateEntryActionPolicy({
    ...policy,
    textArtifacts: [{ ...policy.textArtifacts[0], pathTemplate: "../{value}.md" }],
  }), code("ENTRY_ACTION_POLICY_INVALID"));
  assert.throws(() => validateAuthorizedPatch({ policy, file: "other.json", collection: "items", field: "name", value: "Ok" }), code("ENTRY_ACTION_POLICY_TARGET_DENIED"));
  assert.doesNotThrow(() => validateAuthorizedPatch({ policy, file: "fixtures/items.json", collection: "items", field: "other", value: "Ok" }));
  assert.doesNotThrow(() => validateAuthorizedPatch({ policy, file: "fixtures/items.json", collection: "items", field: "name", value: null }));
  assert.throws(() => validateAuthorizedRow({
    policy,
    file: "fixtures/items.json",
    collection: "items",
    row: { owner: "enemy" },
  }), code("ENTRY_ACTION_POLICY_ROW_DENIED"));
  assert.throws(() => validateAuthorizedTextArtifact({
    policy,
    artifactId: "item-doc",
    path: "docs/items/other.md",
    sourceValue: "item_alpha",
    beforeExists: false,
    afterContent: "# Alpha\n",
  }), code("ENTRY_ACTION_POLICY_TEXT_ARTIFACT_DENIED"));
  assert.throws(() => validateAuthorizedTextArtifact({
    policy,
    artifactId: "item-doc",
    path: "docs/items/../escape.md",
    sourceValue: "../escape",
    beforeExists: false,
    afterContent: "# Alpha\n",
  }), code("ENTRY_ACTION_POLICY_TEXT_ARTIFACT_DENIED"));
});
