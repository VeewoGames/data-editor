import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { prepareCandidateCreate } from "../src/entry-action-candidate-create.mjs";
import { assertCandidateRowSchema, validateCandidateRowSchema } from "../src/entry-action-candidate-row-schema.mjs";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const documentText = '{"items":[]}';
const binding = {
  projectId: "fixture", runId: "conditional-run", actionId: "create-item", sourcePath: "data/items.json",
  collectionPath: "items", canonicalFileKey: "a".repeat(64), baseDocumentEtag: `"${hash(documentText)}"`,
  ruleDigest: "b".repeat(64), fencingToken: 1, createContractId: "fixture.create.v1", createContractDigest: "c".repeat(64),
};
const condition = (properties, required) => ({ if: { properties, required: Object.keys(properties) }, then: { required } });
const schema = {
  type: "object", additionalProperties: false, required: ["slug", "kind", "status", "__entry_id"],
  properties: {
    slug: { type: "string", minLength: 1 }, kind: { type: "string", enum: ["basic", "advanced"] },
    mode: { type: "string", enum: ["simple", "detailed"] }, tier: { type: "string", enum: ["A", "B"] },
    details: { type: "string", minLength: 1 }, status: { type: "string", enum: ["draft", "published"] },
    __entry_id: { type: "string", minLength: 1 },
  },
  allOf: [condition({ kind: { const: "advanced" } }, ["tier"])],
};
const contract = {
  contractId: binding.createContractId, digest: binding.createContractDigest, collectionKind: "array",
  rowSchema: schema, requiredFields: ["slug", "kind"], writableFields: ["slug", "kind", "mode", "tier", "details"],
  serverOwnedFields: ["status"], serverDefaults: { status: "draft" }, uniqueKeys: [["slug"]],
  humanNoteFields: [], textArtifactPolicy: { required: false },
};
const manifest = (row) => ({
  version: 1, kind: "candidate-create", candidateId: "candidate-alpha", designSubjectDigest: "d".repeat(64),
  row: { slug: "alpha", kind: "basic", ...row }, textArtifact: null, summary: "Create an item",
});
const prepare = (row = {}, changes = {}) => prepareCandidateCreate({
  manifest: manifest(row), binding, createContract: { ...contract, ...changes }, documentText,
});

test("candidate prepare applies conditional required fields and preserves optional enum checks", async () => {
  const before = structuredClone(schema);
  await assert.rejects(prepare({ kind: "advanced" }), { code: "CANDIDATE_CREATE_SCHEMA_INVALID" });
  assert.equal((await prepare({ kind: "advanced", tier: "A" })).row.tier, "A");
  assert.equal(Object.hasOwn((await prepare()).row, "tier"), false);
  await assert.rejects(prepare({ tier: "Z" }), { code: "CANDIDATE_CREATE_SCHEMA_INVALID" });
  assert.deepEqual(schema, before);
});

test("candidate prepare accumulates matching conditions and requires every selector to be present", async () => {
  const rowSchema = { ...schema, allOf: [...schema.allOf, condition({ mode: { enum: ["detailed"] } }, ["details"])] };
  await assert.rejects(prepare({ kind: "advanced", mode: "detailed", tier: "A" }, { rowSchema }), { code: "CANDIDATE_CREATE_SCHEMA_INVALID" });
  await assert.rejects(prepare({ kind: "advanced", mode: "detailed", details: "provided" }, { rowSchema }), { code: "CANDIDATE_CREATE_SCHEMA_INVALID" });
  assert.equal((await prepare({ kind: "advanced", mode: "detailed", tier: "A", details: "provided" }, { rowSchema })).row.details, "provided");
  assert.equal((await prepare({}, { rowSchema })).row.kind, "basic");
  const twoSelectors = { ...schema, allOf: [condition({ kind: { const: "advanced" }, mode: { const: "detailed" } }, ["details"])] };
  assert.equal((await prepare({ kind: "advanced" }, { rowSchema: twoSelectors })).row.kind, "advanced");
  await assert.rejects(prepare({ kind: "advanced", mode: "detailed" }, { rowSchema: twoSelectors }), { code: "CANDIDATE_CREATE_SCHEMA_INVALID" });
});

test("conditional server fields wait for final assembly and server defaults can activate requirements", async () => {
  const serverRequired = { ...schema, allOf: [condition({ kind: { const: "advanced" } }, ["status"])] };
  assert.equal((await prepare({ kind: "advanced" }, { rowSchema: serverRequired })).row.status, "draft");
  const defaultActivates = { ...schema, allOf: [condition({ status: { const: "draft" } }, ["details"])] };
  await assert.rejects(prepare({}, { rowSchema: defaultActivates }), { code: "CANDIDATE_CREATE_SCHEMA_INVALID" });
  assert.equal((await prepare({ details: "provided" }, { rowSchema: defaultActivates })).row.details, "provided");
  assert.equal((await prepare({}, { rowSchema: defaultActivates, serverDefaults: { status: "published" } })).row.status, "published");
});

test("conditional definitions reject unsupported grammar, wrong references and invalid matcher values", async () => {
  const valid = condition({ kind: { const: "advanced" } }, ["tier"]);
  const invalidRules = [
    [], [null], [{ ...valid, else: { required: ["details"] } }],
    [{ ...valid, if: { ...valid.if, additionalProperties: false } }],
    [{ ...valid, then: { required: ["tier"], properties: {} } }],
    [condition({ typo: { const: "advanced" } }, ["tier"])],
    [condition({ kind: { const: "advanced" } }, ["typo"])],
    [{ ...valid, if: { ...valid.if, required: [] } }],
    [{ ...valid, if: { ...valid.if, required: ["kind", "kind"] } }],
    [{ ...valid, if: { ...valid.if, required: ["mode"] } }],
    [condition({}, ["tier"])], [condition({ kind: { const: "advanced" } }, [])],
    [condition({ kind: { const: "advanced" } }, ["tier", "tier"])],
    [condition({ kind: { pattern: "advanced" } }, ["tier"])],
    [condition({ kind: { const: "advanced", enum: ["advanced"] } }, ["tier"])],
    ...[[], "advanced", ["advanced", "advanced"], ["unknown"], [1], [null], [undefined], [NaN]].map((value) => [condition({ kind: { enum: value } }, ["tier"])]),
    ...["unknown", 1, undefined, NaN].map((value) => [condition({ kind: { const: value } }, ["tier"])]),
  ];
  for (const allOf of invalidRules) {
    const rowSchema = { ...schema, allOf };
    assert.throws(() => validateCandidateRowSchema(rowSchema), { code: "CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID" });
    await assert.rejects(prepare({}, { rowSchema }), { code: "CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID" });
  }
});

test("nested object conditions use their own properties and are enforced by the same schema validator", () => {
  const nested = {
    type: "object", additionalProperties: false, properties: {
      settings: { type: "object", additionalProperties: false, properties: { enabled: { type: "boolean" }, label: { type: "string" } },
        allOf: [condition({ enabled: { const: true } }, ["label"])] },
    },
  };
  assertCandidateRowSchema(nested, { settings: { enabled: false } });
  assert.throws(() => assertCandidateRowSchema(nested, { settings: { enabled: true } }), { code: "CANDIDATE_CREATE_SCHEMA_INVALID" });
  const wrongScope = structuredClone(nested);
  wrongScope.properties.settings.allOf[0].then.required = ["settings"];
  assert.throws(() => validateCandidateRowSchema(wrongScope), { code: "CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID" });
});
