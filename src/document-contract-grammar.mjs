import Ajv2020 from "ajv/dist/2020.js";

export const documentContractGrammarVersion = 1;
export const documentContractGrammarLimits = Object.freeze({ maxCollections: 8, maxInvariants: 64, maxDerivedOutputs: 32, maxStringLength: 512, maxConditionDepth: 8, maxConditionItems: 32, maxLiteralItems: 64, maxCollectionEntries: 1024 });

/** The engine-owned surface deliberately has no executable/project callback escape hatch. */
export const documentContractGrammarSchema = Object.freeze({
  $id: "data-editor/document-contract-v1/grammar.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["contract_version", "grammar_version", "collections", "invariants", "derivedOutputs", "savePolicy"],
  properties: {
    contract_version: { type: "integer", minimum: 1 },
    grammar_version: { const: documentContractGrammarVersion },
    collections: { type: "array", minItems: 1, maxItems: documentContractGrammarLimits.maxCollections, items: { $ref: "#/$defs/collection" } },
    invariants: { type: "array", maxItems: documentContractGrammarLimits.maxInvariants, items: { $ref: "#/$defs/invariant" } },
    derivedOutputs: { type: "array", maxItems: documentContractGrammarLimits.maxDerivedOutputs, items: { $ref: "#/$defs/derivedOutput" } },
    savePolicy: { $ref: "#/$defs/savePolicy" },
  },
  $defs: {
    collection: {
      type: "object", additionalProperties: false, required: ["path", "entryKind", "allowMissing"],
      properties: { path: { type: "string", minLength: 1, maxLength: 128 }, entryKind: { enum: ["array", "object"] }, allowMissing: { type: "boolean" }, uniqueBy: { type: "string", minLength: 1, maxLength: 128 }, uniqueIssue: { $ref: "#/$defs/issue" } },
    },
    invariant: {
      type: "object", additionalProperties: false, required: ["id", "scope", "assert", "issue"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 128 }, scope: { enum: ["document", "entry"] }, eachPath: { type: "string", minLength: 1, maxLength: 128 }, when: { $ref: "#/$defs/condition" },
        assert: { type: "object" }, issue: { $ref: "#/$defs/issue" },
      },
    },
    derivedOutput: {
      type: "object", additionalProperties: false, required: ["id", "scope", "kind", "path"],
      properties: { id: { type: "string", minLength: 1, maxLength: 128 }, scope: { enum: ["document", "entry"] }, kind: { enum: ["count", "textTemplate"] }, path: { type: "string", minLength: 1, maxLength: 128 }, template: { type: "string", maxLength: documentContractGrammarLimits.maxStringLength } },
    },
    savePolicy: {
      type: "object", additionalProperties: false, required: ["requireExactTokenSet", "validateCandidate", "blockingIssues"],
      properties: { requireExactTokenSet: { const: true }, validateCandidate: { const: true }, blockingIssues: { const: true } },
    },
    issue: {
      type: "object", additionalProperties: false, required: ["code", "message"],
      properties: { code: { type: "string", minLength: 1, maxLength: 128 }, message: { type: "string", minLength: 1, maxLength: documentContractGrammarLimits.maxStringLength }, path: { type: "string", maxLength: 128 } },
    },
    condition: { type: "object" },
  },
});

const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(documentContractGrammarSchema);
const conditionOps = new Set(["exists", "equals", "in", "all", "any", "not"]);
const assertOps = new Set(["required", "integerRange", "numberRange", "oneOf", "nonEmptyArray", "compare_lte"]);

export class DocumentContractGrammarError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "DocumentContractGrammarError";
    this.code = code;
    this.details = details;
  }
}

export function isDocumentContractGrammar(value) {
  return isPlainObject(value) && ["grammar_version", "collections", "invariants", "derivedOutputs", "savePolicy"].some((key) => Object.hasOwn(value, key));
}

export function validateDocumentContractGrammar(contract) {
  if (!validateSchema(contract)) throw fail("DOCUMENT_CONTRACT_GRAMMAR_SCHEMA_INVALID", "Document contract does not satisfy the engine grammar schema.", validateSchema.errors ?? []);
  const collectionPaths = new Set();
  for (const collection of contract.collections) {
    assertStaticPath(collection.path, "collection.path");
    if (collectionPaths.has(collection.path)) throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", `Duplicate collection declaration: ${collection.path}.`);
    collectionPaths.add(collection.path);
    if (collection.uniqueBy != null) {
      assertStaticPath(collection.uniqueBy, "collection.uniqueBy");
      if (collection.entryKind !== "array") throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "uniqueBy is only permitted for array collections.");
      if (collection.uniqueIssue != null && collection.uniqueIssue.path != null) assertStaticPath(collection.uniqueIssue.path, "collection.uniqueIssue.path");
    }
  }
  uniqueIds(contract.invariants, "invariant");
  uniqueIds(contract.derivedOutputs, "derived output");
  for (const invariant of contract.invariants) {
    if (invariant.when != null) validateCondition(invariant.when);
    if (invariant.eachPath != null) {
      if (invariant.scope !== "entry") throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "eachPath is only permitted for entry-scoped invariants.");
      assertStaticPath(invariant.eachPath, "invariant.eachPath");
    }
    validateAssertion(invariant.assert);
    if (invariant.issue.path != null) assertStaticPath(invariant.issue.path, "issue.path");
  }
  for (const output of contract.derivedOutputs) {
    assertStaticPath(output.path, "derivedOutput.path");
    if (output.kind === "textTemplate" && typeof output.template !== "string") {
      throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", `Derived output ${output.id} requires a static template.`);
    }
  }
  return contract;
}

function validateCondition(condition, depth = 0) {
  if (!isPlainObject(condition) || depth > documentContractGrammarLimits.maxConditionDepth || !conditionOps.has(condition.op)) throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "Condition operator is not permitted.");
  if (["all", "any"].includes(condition.op)) {
    assertExactKeys(condition, ["op", "conditions"], "condition");
    if (!Array.isArray(condition.conditions) || condition.conditions.length === 0 || condition.conditions.length > documentContractGrammarLimits.maxConditionItems) throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "Composite condition must contain a bounded condition list.");
    condition.conditions.forEach((item) => validateCondition(item, depth + 1));
    return;
  }
  if (condition.op === "not") {
    assertExactKeys(condition, ["op", "condition"], "condition");
    validateCondition(condition.condition, depth + 1);
    return;
  }
  if (condition.op === "exists") assertExactKeys(condition, ["op", "path"], "condition");
  if (condition.op === "equals") assertExactKeys(condition, ["op", "path", "value"], "condition");
  if (condition.op === "in") assertExactKeys(condition, ["op", "path", "values"], "condition");
  assertStaticPath(condition.path, "condition.path");
  if (condition.op === "in" && (!Array.isArray(condition.values) || condition.values.length === 0 || condition.values.length > documentContractGrammarLimits.maxLiteralItems)) {
    throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "The in condition requires a bounded literal value list.");
  }
  if (condition.op === "equals") assertScalarLiteral(condition.value);
  if (condition.op === "in") assertScalarList(condition.values);
}

function validateAssertion(assertion) {
  if (!isPlainObject(assertion) || !assertOps.has(assertion.op)) throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "Assertion operator is not permitted.");
  if (assertion.op === "compare_lte") {
    assertExactKeys(assertion, ["op", "leftPath", "rightPath"], "assertion");
    assertStaticPath(assertion.leftPath, "assert.leftPath");
    assertStaticPath(assertion.rightPath, "assert.rightPath");
    return;
  }
  if (["required", "nonEmptyArray"].includes(assertion.op)) assertExactKeys(assertion, ["op", "path"], "assertion");
  if (["integerRange", "numberRange"].includes(assertion.op)) assertExactKeys(assertion, ["op", "path", "min", "max"], "assertion");
  if (assertion.op === "oneOf") assertExactKeys(assertion, ["op", "path", "values"], "assertion");
  assertStaticPath(assertion.path, "assert.path");
  if (["integerRange", "numberRange"].includes(assertion.op)) {
    if (assertion.min != null && !Number.isFinite(assertion.min)) throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "Range minimum must be finite.");
    if (assertion.max != null && !Number.isFinite(assertion.max)) throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "Range maximum must be finite.");
    if (assertion.min != null && assertion.max != null && assertion.min > assertion.max) throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "Range minimum cannot exceed maximum.");
    if (assertion.min == null && assertion.max == null) throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "A range assertion requires a minimum or maximum.");
  }
  if (assertion.op === "oneOf" && (!Array.isArray(assertion.values) || assertion.values.length === 0 || assertion.values.length > documentContractGrammarLimits.maxLiteralItems)) {
    throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "oneOf requires a bounded literal value list.");
  }
  if (assertion.op === "oneOf") assertScalarList(assertion.values);
}

function uniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", `Duplicate ${label} id: ${item.id}.`);
    ids.add(item.id);
  }
}

function assertStaticPath(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,7}$/.test(value)
    || value.split(".").some((part) => ["__proto__", "prototype", "constructor"].includes(part))) {
    throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", `${label} must be a bounded static object path.`);
  }
}

function assertScalarList(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > documentContractGrammarLimits.maxLiteralItems) {
    throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "Grammar literal lists must be non-empty and bounded.");
  }
  value.forEach(assertScalarLiteral);
}

function assertScalarLiteral(value) {
  if (typeof value === "string") {
    if (value.length <= documentContractGrammarLimits.maxStringLength) return;
    throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "Grammar string literals exceed the bounded length.");
  }
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", "Only finite JSON scalar literals are permitted in grammar operands.");
}

function assertExactKeys(value, keys, label) {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw fail("DOCUMENT_CONTRACT_GRAMMAR_INVALID", `${label} contains an unsupported payload field.`);
}

function isPlainObject(value) { return value != null && typeof value === "object" && !Array.isArray(value); }
function fail(code, message, details = null) { return new DocumentContractGrammarError(code, message, details); }
