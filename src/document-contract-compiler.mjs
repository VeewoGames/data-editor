import { createHash } from "node:crypto";
import { documentContractGrammarVersion, documentContractGrammarLimits, isDocumentContractGrammar, validateDocumentContractGrammar, DocumentContractGrammarError } from "./document-contract-grammar.mjs";

/** Compiles only a declarative, bounded document-contract-v1. Legacy contracts remain opaque until stage 3 removes their route. */
export function compileDocumentContract(contract, binding) {
  if (!isDocumentContractGrammar(contract)) return Object.freeze({ kind: "legacy", contractVersion: contract.contract_version });
  validateDocumentContractGrammar(contract);
  const matching = contract.collections.filter((collection) => collection.path === binding.match.collection);
  if (contract.collections.length !== 1 || matching.length !== 1) {
    throw new DocumentContractGrammarError("DOCUMENT_CONTRACT_COLLECTION_BINDING_MISMATCH", `Contract must declare exactly its bound collection: ${binding.match.collection}.`);
  }
  const [target] = matching;
  const plan = {
    kind: "compiled",
    grammarVersion: documentContractGrammarVersion,
    contractVersion: contract.contract_version,
    bindingId: binding.id,
    collection: structuredClone(target),
    invariants: structuredClone(contract.invariants),
    derivedOutputs: structuredClone(contract.derivedOutputs),
    savePolicy: structuredClone(contract.savePolicy),
  };
  plan.compiledContractDigest = digest({ grammarVersion: documentContractGrammarVersion, plan });
  return deepFreeze(plan);
}

export function validateDocumentContractCandidate(resolution, root) {
  const issues = [];
  for (const { binding, loaded } of resolution.contracts ?? []) {
    const compiled = loaded.compiled;
    if (compiled?.kind !== "compiled") continue;
    const collection = readPath(root, compiled.collection.path);
    const basePath = compiled.collection.path;
    if (collection === missing) {
      if (!compiled.collection.allowMissing) issues.push(issue(binding.id, "DOCUMENT_CONTRACT_COLLECTION_MISSING", basePath, `Required collection ${basePath} is missing.`));
      continue;
    }
    if (!matchesEntryKind(collection, compiled.collection.entryKind)) {
      issues.push(issue(binding.id, "DOCUMENT_CONTRACT_COLLECTION_TYPE_INVALID", basePath, `Collection ${basePath} must be a ${compiled.collection.entryKind}.`));
      continue;
    }
    const entries = compiled.collection.entryKind === "array" ? collection : [collection];
    if (entries.length > documentContractGrammarLimits.maxCollectionEntries) {
      issues.push(issue(binding.id, "DOCUMENT_CONTRACT_COLLECTION_CARDINALITY_EXCEEDED", basePath, "Contract collection evaluation exceeds the bounded cardinality."));
      continue;
    }
    if (compiled.collection.uniqueBy) validateCollectionUniqueBy(compiled.collection, entries, basePath, issues, binding.id);
    for (const invariant of compiled.invariants) {
      if (invariant.scope === "document") evaluateInvariant(invariant, root, basePath, issues, binding.id);
      else entries.forEach((entry, index) => evaluateEntryInvariant(invariant, entry, `${basePath}[${index}]`, issues, binding.id));
    }
  }
  return { ok: issues.length === 0, issues };
}

/** The exact, sorted admission token set a client must echo for this document. */
export function documentContractTokens(resolution) {
  return (resolution.contracts ?? []).map(({ binding, loaded }) => ({
    contractId: binding.id,
    generation: resolution.state.generation,
    manifestDigest: resolution.state.manifestDigest,
    contractDigest: loaded.contractDigest,
    compiledContractDigest: loaded.compiled?.compiledContractDigest ?? null,
    version: loaded.version,
  })).sort((left, right) => left.contractId.localeCompare(right.contractId));
}

/** A durable snapshot reused before replacement, after replacement, and by identity promotion. */
export function documentContractAdmissionSnapshot(resolution) {
  return {
    generation: resolution.state.generation,
    manifestDigest: resolution.state.manifestDigest,
    contracts: documentContractTokens(resolution).map((token) => ({
      ...token,
      compiledKind: resolution.contracts.find(({ binding }) => binding.id === token.contractId)?.loaded.compiled?.kind ?? "legacy",
    })),
  };
}

export function assertExactDocumentContractTokens(actual, resolution) {
  const expected = documentContractTokens(resolution);
  const normalized = Array.isArray(actual) ? actual.map((token) => ({
    contractId: token?.contractId,
    generation: token?.generation,
    manifestDigest: token?.manifestDigest,
    contractDigest: token?.contractDigest,
    compiledContractDigest: token?.compiledContractDigest ?? null,
    version: token?.version,
  })).sort((left, right) => String(left.contractId).localeCompare(String(right.contractId))) : null;
  return { ok: normalized != null && stableJson(normalized) === stableJson(expected), expected, actual: normalized };
}

export function validateDocumentContractTokenSet(actual, resolution) {
  if (!(resolution.contracts ?? []).length) {
    return Array.isArray(actual) && actual.length > 0
      ? { ok: false, code: "DOCUMENT_CONTRACT_TOKEN_UNEXPECTED" }
      : { ok: true };
  }
  if (!Array.isArray(actual)) return { ok: false, code: "DOCUMENT_CONTRACT_TOKEN_MISSING" };
  const check = assertExactDocumentContractTokens(actual, resolution);
  return check.ok ? { ok: true } : { ok: false, code: "DOCUMENT_CONTRACT_TOKEN_STALE", expected: check.expected };
}

/** Validates a persisted candidate against the same admission snapshot captured before replacement. */
export function verifyDocumentContractPostReplace({ admissionSnapshot, resolution, root }) {
  if ((resolution.contracts ?? []).length > 0 && !isDocumentContractAdmissionSnapshot(admissionSnapshot, resolution.contracts.length)) {
    return { ok: false, code: "DOCUMENT_CONTRACT_ADMISSION_SNAPSHOT_MISSING" };
  }
  const actualSnapshot = documentContractAdmissionSnapshot(resolution);
  if (admissionSnapshot && stableJson(admissionSnapshot) !== stableJson(actualSnapshot)) {
    return { ok: false, code: "DOCUMENT_CONTRACT_CHANGED_DURING_SAVE", expected: admissionSnapshot, actual: actualSnapshot };
  }
  const candidate = validateDocumentContractCandidate(resolution, root);
  if (!candidate.ok) return { ok: false, code: "DOCUMENT_CONTRACT_CANDIDATE_INVALID", issues: candidate.issues };
  return { ok: true, admissionSnapshot: actualSnapshot };
}

function evaluateEntryInvariant(invariant, entry, entryPath, issues, contractId) {
  if (!invariant.eachPath) return evaluateInvariant(invariant, entry, entryPath, issues, contractId);
  const items = readPath(entry, invariant.eachPath);
  if (!Array.isArray(items)) return evaluateInvariant(invariant, missing, `${entryPath}.${invariant.eachPath}`, issues, contractId);
  if (items.length > documentContractGrammarLimits.maxCollectionEntries) {
    issues.push(issue(contractId, "DOCUMENT_CONTRACT_COLLECTION_CARDINALITY_EXCEEDED", `${entryPath}.${invariant.eachPath}`, "Contract array evaluation exceeds the bounded cardinality."));
    return;
  }
  items.forEach((item, index) => evaluateInvariant(invariant, item, `${entryPath}.${invariant.eachPath}[${index}]`, issues, contractId));
}

export function evaluateDocumentContractDerivedOutputs(resolution, root) {
  const output = [];
  for (const { binding, loaded } of resolution.contracts ?? []) {
    const compiled = loaded.compiled;
    if (compiled?.kind !== "compiled") continue;
    const collection = readPath(root, compiled.collection.path);
    if (!matchesEntryKind(collection, compiled.collection.entryKind)) continue;
    const entries = compiled.collection.entryKind === "array" ? collection : [collection];
    if (entries.length > documentContractGrammarLimits.maxCollectionEntries) {
      throw new DocumentContractRuntimeError("DOCUMENT_CONTRACT_DERIVED_OUTPUT_CARDINALITY_EXCEEDED", "Derived output evaluation exceeds the bounded collection cardinality.");
    }
    for (const declaration of compiled.derivedOutputs) {
      const contexts = declaration.scope === "document" ? [{ value: root, path: compiled.collection.path }] : entries.map((value, index) => ({ value, path: `${compiled.collection.path}[${index}]` }));
      for (const context of contexts) {
        const value = readPath(context.value, declaration.path);
        const resolved = declaration.kind === "count" ? (Array.isArray(value) ? value.length : 0) : declaration.template.replaceAll("{value}", value === missing ? "" : String(value));
        output.push({ contractId: binding.id, id: declaration.id, path: context.path, value: resolved, persistent: false });
      }
    }
  }
  return output;
}

export class DocumentContractRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DocumentContractRuntimeError";
    this.code = code;
  }
}

function evaluateInvariant(invariant, value, basePath, issues, contractId) {
  if (invariant.when && !evaluateCondition(invariant.when, value)) return;
  if (evaluateAssertion(invariant.assert, value)) return;
  issues.push(issue(contractId, invariant.issue.code, issuePath(invariant.scope, basePath, invariant.issue.path), invariant.issue.message));
}

function validateCollectionUniqueBy(collection, entries, basePath, issues, contractId) {
  const seen = new Map();
  entries.forEach((entry, index) => {
    const value = readPath(entry, collection.uniqueBy);
    if (value === missing) return;
    const key = JSON.stringify(value);
    if (seen.has(key)) {
      const issueSpec = collection.uniqueIssue ?? { code: "DOCUMENT_CONTRACT_COLLECTION_UNIQUE", message: `Collection values must be unique by ${collection.uniqueBy}.`, path: collection.uniqueBy };
      issues.push(issue(contractId, issueSpec.code, `${basePath}[${index}].${issueSpec.path ?? collection.uniqueBy}`, issueSpec.message));
      return;
    }
    seen.set(key, index);
  });
}

function evaluateCondition(condition, value) {
  switch (condition.op) {
    case "exists": return readPath(value, condition.path) !== missing;
    case "equals": return Object.is(readPath(value, condition.path), condition.value);
    case "in": return condition.values.some((item) => Object.is(readPath(value, condition.path), item));
    case "all": return condition.conditions.every((item) => evaluateCondition(item, value));
    case "any": return condition.conditions.some((item) => evaluateCondition(item, value));
    case "not": return !evaluateCondition(condition.condition, value);
    default: return false;
  }
}

function evaluateAssertion(assertion, value) {
  const current = assertion.op === "compare_lte" ? null : readPath(value, assertion.path);
  switch (assertion.op) {
    case "required": return current !== missing && current !== null && current !== "";
    case "integerRange": return Number.isInteger(current) && (assertion.min == null || current >= assertion.min) && (assertion.max == null || current <= assertion.max);
    case "numberRange": return Number.isFinite(current) && (assertion.min == null || current >= assertion.min) && (assertion.max == null || current <= assertion.max);
    case "oneOf": return assertion.values.some((item) => Object.is(item, current));
    case "nonEmptyArray": return Array.isArray(current) && current.length > 0;
    case "compare_lte": {
      const left = readPath(value, assertion.leftPath); const right = readPath(value, assertion.rightPath);
      return Number.isFinite(left) && Number.isFinite(right) && left <= right;
    }
    default: return false;
  }
}

function matchesEntryKind(value, kind) { return kind === "array" ? Array.isArray(value) : isPlainObject(value); }
function issuePath(scope, basePath, relativePath) {
  // Document issues are absolute root paths; entry issues are paths relative to the current collection entry.
  if (scope === "document") return relativePath || basePath;
  return relativePath ? `${basePath}.${relativePath}` : basePath;
}
function readPath(value, path) {
  let current = value;
  for (const part of path.split(".")) {
    if (!isPlainObject(current) || !Object.hasOwn(current, part)) return missing;
    current = current[part];
  }
  return current;
}
function issue(contractId, code, path, message) { return { contractId, code, path, message, blocking: true }; }
function isPlainObject(value) { return value != null && typeof value === "object" && !Array.isArray(value); }
const missing = Symbol("missing");
function digest(value) { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function isDocumentContractAdmissionSnapshot(value, expectedContractCount = null) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    && Number.isInteger(value.generation) && typeof value.manifestDigest === "string"
    && Array.isArray(value.contracts)
    && (expectedContractCount == null || value.contracts.length === expectedContractCount)
    && value.contracts.every((item) => item && typeof item === "object" && !Array.isArray(item)
      && typeof item.contractId === "string" && typeof item.contractDigest === "string"
      && (item.compiledContractDigest == null || typeof item.compiledContractDigest === "string")
      && Number.isInteger(item.generation) && typeof item.manifestDigest === "string"
      && Number.isInteger(item.version) && typeof item.compiledKind === "string");
}
