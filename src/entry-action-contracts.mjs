import crypto from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { validateCandidateRowSchema } from "./entry-action-candidate-row-schema.mjs";
import { assertTextArtifactSectionPolicy, normalizeSectionOnlyPolicy } from "./entry-action-text-section-policy.mjs";

const DIGEST = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9._-]+$/;
const OPS = new Set(["eq", "in", "notIn", "exists"]);

export async function loadEntryActionContracts(projectContextOrRoot) {
  const projectRoot = path.resolve(projectContextOrRoot?.projectRoot ?? projectContextOrRoot);
  const file = path.join(projectRoot, ".data-editor", "entry-action-contracts.json");
  const value = JSON.parse(await readFile(file, "utf8"));
  return validateEntryActionContracts(value);
}

export function validateEntryActionContracts(value) {
  exact(value, ["contracts", "version"], "entry action contracts");
  if (value.version !== 1 || !Array.isArray(value.contracts)) invalid("entry action contracts version or list is invalid");
  const ids = new Set();
  const contracts = value.contracts.map((item) => {
    const contract = normalizeContract(item);
    if (ids.has(contract.contractId)) invalid(`duplicate entry action contract: ${contract.contractId}`);
    ids.add(contract.contractId);
    return contract;
  });
  return { version: 1, contracts };
}

export function resolveEntryActionContract(registry, contractId) {
  const contract = registry?.contracts?.find((item) => item.contractId === contractId);
  if (!contract) invalid(`entry action contract is unavailable: ${contractId}`, "ENTRY_ACTION_CONTRACT_UNAVAILABLE");
  return contract;
}

export function assertEntryActionPredicate(predicate, row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) invalid("entry action predicate row is invalid", "ENTRY_ACTION_PREDICATE_FAILED");
  for (const clause of predicate.all) {
    const exists = Object.hasOwn(row, clause.field);
    const current = row[clause.field];
    const pass = clause.op === "exists" ? exists === clause.value
      : clause.op === "eq" ? exists && stableJson(current) === stableJson(clause.value)
        : clause.op === "in" ? exists && clause.values.some((value) => stableJson(value) === stableJson(current))
          : exists && !clause.values.some((value) => stableJson(value) === stableJson(current));
    if (!pass) invalid(`entry action predicate failed: ${clause.field}`, "ENTRY_ACTION_PREDICATE_FAILED");
  }
}

export function assertEntryActionChanges(contract, changes, currentRow = null) {
  const writable = new Set(contract.writableFields);
  const byField = new Map((changes ?? []).map((change) => [change.field, change]));
  const resultRow = currentRow && typeof currentRow === "object" && !Array.isArray(currentRow) ? structuredClone(currentRow) : {};
  for (const change of changes ?? []) {
    if (change.afterExists === false) delete resultRow[change.field];
    else resultRow[change.field] = structuredClone(change.after);
  }
  for (const change of changes ?? []) {
    if (!writable.has(change.field)) invalid(`entry action field is not writable: ${change.field}`, "ENTRY_ACTION_FIELD_FORBIDDEN");
    const transitions = contract.legalTransitions.filter((item) => item.field === change.field);
    if (transitions.length === 0) continue;
    const admitted = transitions.some((transition) => transition.from.some((value) => stableJson(value) === stableJson(change.before))
      && transitionTargetMatches(transition, change.after)
      && transition.requires.every((requirement) => {
        const requiredChange = byField.get(requirement.field);
        return requiredChange
          && requirement.from.some((value) => stableJson(value) === stableJson(requiredChange.before))
          && requirement.to.some((value) => stableJson(value) === stableJson(requiredChange.after))
          && stableJson(resultRow[requirement.field]) === stableJson(requiredChange.after);
      }));
    if (!admitted) invalid(`entry action transition is illegal: ${change.field}`, "ENTRY_ACTION_TRANSITION_ILLEGAL");
  }
}

function normalizeContract(value) {
  const contractFields = ["contractId", "createAuthority", "digest", "evidencePolicy", "legalTransitions", "predicate", "resultPolicy", "textArtifactPolicy", "version", "writableFields", ...(Object.hasOwn(value ?? {}, "projectTransaction") ? ["projectTransaction"] : [])];
  exact(value, contractFields, "entry action contract");
  requiredId(value.contractId, "contractId");
  if (!Number.isSafeInteger(value.version) || value.version < 1) invalid("contract version is invalid");
  if (!DIGEST.test(value.digest)) invalid("contract digest is invalid");
  const withoutDigest = { ...value }; delete withoutDigest.digest;
  const expected = digest(canonicalJson(withoutDigest));
  if (value.digest !== expected) invalid("contract digest does not match content", "ENTRY_ACTION_CONTRACT_DIGEST_MISMATCH");
  const predicate = normalizePredicate(value.predicate);
  const writableFields = stringArray(value.writableFields, "writableFields");
  const legalTransitions = normalizeTransitions(value.legalTransitions);
  if (!["proposal", "result-only", "project-transaction"].includes(value.resultPolicy)) invalid("contract resultPolicy is invalid");
  const textArtifactPolicy = normalizeTextArtifactPolicy(value.textArtifactPolicy);
  const evidencePolicy = normalizeEvidencePolicy(value.evidencePolicy);
  const createAuthority = value.createAuthority === null ? null : normalizeCreateAuthority(value.createAuthority);
  const projectTransaction = normalizeProjectTransaction(value.projectTransaction ?? null, value.resultPolicy);
  return structuredClone({ ...value, predicate, writableFields, legalTransitions, textArtifactPolicy, evidencePolicy, createAuthority, projectTransaction });
}

function normalizeProjectTransaction(value, resultPolicy) {
  if (value === null) { if (resultPolicy === "project-transaction") invalid("projectTransaction is required"); return null; }
  exact(value, ["capabilityId", "ownerId"], "projectTransaction");
  requiredId(value.ownerId, "projectTransaction.ownerId"); requiredId(value.capabilityId, "projectTransaction.capabilityId");
  if (resultPolicy !== "project-transaction") invalid("projectTransaction requires project-transaction resultPolicy");
  return structuredClone(value);
}

function normalizeCreateAuthority(value) {
  const fields = ["candidateIdPolicy", "collectionKind", "contractId", "createAdapter", "digest", "humanNoteDefaults", "humanNoteFields", "requiredFields", "rowSchema", "serverDefaults", "serverOwnedFields", "textArtifactPolicy", "uniqueKeys", "writableFields"];
  exact(value, fields, "createAuthority");
  requiredId(value.contractId, "createAuthority.contractId");
  if (!DIGEST.test(value.digest) || value.collectionKind !== "array") invalid("createAuthority identity is invalid");
  const withoutDigest = { ...value }; delete withoutDigest.digest;
  if (digest(canonicalJson(withoutDigest)) !== value.digest) invalid("createAuthority digest does not match content", "ENTRY_ACTION_CONTRACT_DIGEST_MISMATCH");
  const rowSchema = validateCandidateRowSchema(value.rowSchema);
  if (!value.candidateIdPolicy || typeof value.candidateIdPolicy !== "object" || Array.isArray(value.candidateIdPolicy) || Object.keys(value.candidateIdPolicy).sort().join(",") !== "field,pattern") invalid("createAuthority candidateIdPolicy is invalid");
  requiredId(value.candidateIdPolicy.field, "createAuthority candidateIdPolicy.field");
  try { new RegExp(value.candidateIdPolicy.pattern, "u"); } catch { invalid("createAuthority candidateIdPolicy.pattern is invalid"); }
  const requiredFields = stringArray(value.requiredFields, "createAuthority.requiredFields");
  const writableFields = stringArray(value.writableFields, "createAuthority.writableFields");
  const serverOwnedFields = stringArray(value.serverOwnedFields, "createAuthority.serverOwnedFields");
  const humanNoteFields = stringArray(value.humanNoteFields, "createAuthority.humanNoteFields");
  const createAdapter = normalizeCreateAdapter(value.createAdapter);
  if (!value.serverDefaults || typeof value.serverDefaults !== "object" || Array.isArray(value.serverDefaults) || !value.humanNoteDefaults || typeof value.humanNoteDefaults !== "object" || Array.isArray(value.humanNoteDefaults)) invalid("createAuthority defaults are invalid");
  if (Object.keys(value.serverDefaults).some((field) => !serverOwnedFields.includes(field)) || Object.keys(value.humanNoteDefaults).some((field) => !humanNoteFields.includes(field))) invalid("createAuthority defaults are not server-owned");
  if (!Array.isArray(value.uniqueKeys) || value.uniqueKeys.length === 0) invalid("createAuthority uniqueKeys are invalid");
  const uniqueKeys = value.uniqueKeys.map((key) => stringArray(key, "createAuthority.uniqueKeys"));
  const textArtifactPolicy = normalizeTextArtifactPolicy(value.textArtifactPolicy);
  return structuredClone({ ...value, rowSchema, requiredFields, writableFields, serverOwnedFields, humanNoteFields, uniqueKeys, textArtifactPolicy, createAdapter });
}

function normalizeCreateAdapter(value) {
  if (value === null) return null;
  exact(value, ["config", "id"], "createAuthority.createAdapter");
  requiredId(value.id, "createAuthority.createAdapter.id");
  if (!value.config || typeof value.config !== "object" || Array.isArray(value.config)) invalid("createAuthority.createAdapter.config is invalid");
  return structuredClone(value);
}

export function assertEntryActionResultPolicies(contract, { textArtifact = null, evidence = [] } = {}) {
  const textPolicy = normalizeTextArtifactPolicy(contract?.textArtifactPolicy);
  const evidencePolicy = normalizeEvidencePolicy(contract?.evidencePolicy);
  if (textPolicy.required && textArtifact === null) invalid("entry action text artifact is required", "ENTRY_ACTION_TEXT_ARTIFACT_REQUIRED");
  if (textArtifact !== null) {
    if (!textArtifact || typeof textArtifact !== "object" || Array.isArray(textArtifact) || typeof textArtifact.path !== "string" || typeof textArtifact.afterContent !== "string") invalid("entry action text artifact is invalid", "ENTRY_ACTION_TEXT_ARTIFACT_POLICY_FAILED");
    if (textPolicy.maxBytes != null && Buffer.byteLength(textArtifact.afterContent, "utf8") > textPolicy.maxBytes) invalid("entry action text artifact exceeds policy", "ENTRY_ACTION_TEXT_ARTIFACT_POLICY_FAILED");
    if (textPolicy.createOnly && textArtifact.beforeExists !== false) invalid("entry action text artifact must be create-only", "ENTRY_ACTION_TEXT_ARTIFACT_POLICY_FAILED");
    if (textPolicy.allowedExtensions.length && !textPolicy.allowedExtensions.some((extension) => textArtifact.path.toLowerCase().endsWith(extension))) invalid("entry action text artifact extension is forbidden", "ENTRY_ACTION_TEXT_ARTIFACT_POLICY_FAILED");
  }
  if (textPolicy.sectionOnly && (textArtifact?.beforeExists === false || Object.hasOwn(textArtifact ?? {}, "beforeContent"))) assertTextArtifactSectionPolicy(textPolicy, textArtifact);
  if (!Array.isArray(evidence)) invalid("entry action evidence is invalid", "ENTRY_ACTION_EVIDENCE_POLICY_FAILED");
  if (evidencePolicy.required && evidence.length === 0) invalid("entry action evidence is required", "ENTRY_ACTION_EVIDENCE_POLICY_FAILED");
  if (evidence.length < evidencePolicy.minItems || evidence.length > evidencePolicy.maxItems) invalid("entry action evidence count violates policy", "ENTRY_ACTION_EVIDENCE_POLICY_FAILED");
  for (const item of evidence) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).sort().join(",") !== "digest,kind,ref" || typeof item.kind !== "string" || !ID.test(item.kind) || typeof item.ref !== "string" || !item.ref || !DIGEST.test(item.digest)) invalid("entry action evidence item is invalid", "ENTRY_ACTION_EVIDENCE_POLICY_FAILED");
    if (evidencePolicy.allowedKinds.length && !evidencePolicy.allowedKinds.includes(item.kind)) invalid("entry action evidence kind is forbidden", "ENTRY_ACTION_EVIDENCE_POLICY_FAILED");
  }
}

function normalizeTextArtifactPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("textArtifactPolicy is invalid");
  const allowed = new Set(["required", "maxBytes", "createOnly", "allowedExtensions", "pathTemplate", "pathKeyField", "textArtifactPathField", "sectionOnly"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) invalid(`unsupported textArtifactPolicy field: ${key}`);
  const required = value.required ?? false;
  const createOnly = value.createOnly ?? false;
  const maxBytes = value.maxBytes ?? null;
  if (typeof required !== "boolean" || typeof createOnly !== "boolean" || (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes < 1))) invalid("textArtifactPolicy is invalid");
  const allowedExtensions = value.allowedExtensions == null ? [] : stringArray(value.allowedExtensions, "textArtifactPolicy.allowedExtensions");
  if (allowedExtensions.some((item) => !/^\.[a-z0-9]+$/.test(item))) invalid("textArtifactPolicy.allowedExtensions is invalid");
  const pathTemplate = value.pathTemplate ?? null;
  const pathKeyField = value.pathKeyField ?? null;
  const textArtifactPathField = value.textArtifactPathField ?? null;
  if ((pathTemplate === null) !== (pathKeyField === null) || (pathTemplate !== null && (typeof pathTemplate !== "string" || !pathTemplate.includes("{key}") || pathTemplate.includes("\\") || pathTemplate.startsWith("/") || pathTemplate.includes("..") || typeof pathKeyField !== "string" || !ID.test(pathKeyField)))) invalid("textArtifactPolicy path template is invalid");
  if (textArtifactPathField !== null && (pathTemplate === null || typeof textArtifactPathField !== "string" || !ID.test(textArtifactPathField))) invalid("textArtifactPolicy textArtifactPathField is invalid");
  const sectionOnly = normalizeSectionOnlyPolicy(value.sectionOnly ?? null, invalid);
  return { required, maxBytes, createOnly, allowedExtensions, pathTemplate, pathKeyField, textArtifactPathField, sectionOnly };
}

function normalizeEvidencePolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("evidencePolicy is invalid");
  const allowed = new Set(["required", "minItems", "maxItems", "allowedKinds"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) invalid(`unsupported evidencePolicy field: ${key}`);
  const required = value.required ?? false;
  const minItems = value.minItems ?? (required ? 1 : 0);
  const maxItems = value.maxItems ?? 64;
  if (typeof required !== "boolean" || !Number.isSafeInteger(minItems) || minItems < 0 || !Number.isSafeInteger(maxItems) || maxItems < minItems || maxItems > 256) invalid("evidencePolicy is invalid");
  const allowedKinds = value.allowedKinds == null ? [] : stringArray(value.allowedKinds, "evidencePolicy.allowedKinds");
  return { required, minItems, maxItems, allowedKinds };
}

function normalizePredicate(value) {
  exact(value, ["all"], "predicate");
  if (!Array.isArray(value.all)) invalid("predicate.all is invalid");
  return { all: value.all.map((clause) => {
    if (!clause || typeof clause !== "object" || Array.isArray(clause)) invalid("predicate clause is invalid");
    if (!OPS.has(clause.op)) invalid("predicate operation is invalid");
    const fields = clause.op === "exists" || clause.op === "eq" ? ["field", "op", "value"] : ["field", "op", "values"];
    exact(clause, fields, "predicate clause");
    requiredId(clause.field, "predicate field");
    if ((clause.op === "in" || clause.op === "notIn") && (!Array.isArray(clause.values) || clause.values.length === 0)) invalid("predicate values are invalid");
    if (clause.op === "exists" && typeof clause.value !== "boolean") invalid("exists predicate value must be boolean");
    return structuredClone(clause);
  }) };
}

function normalizeTransitions(value) {
  if (!Array.isArray(value)) invalid("legalTransitions is invalid");
  return value.map((item) => {
    const hasTo = Object.hasOwn(item ?? {}, "to");
    const hasToPattern = Object.hasOwn(item ?? {}, "toPattern");
    if (hasTo === hasToPattern) invalid("legal transition requires exactly one of to or toPattern");
    const fields = ["field", "from", hasTo ? "to" : "toPattern", ...(Object.hasOwn(item ?? {}, "requires") ? ["requires"] : [])];
    exact(item, fields, "legal transition");
    requiredId(item.field, "transition field");
    if (!Array.isArray(item.from) || !item.from.length || (hasTo && (!Array.isArray(item.to) || !item.to.length))) invalid("legal transition values are invalid");
    if (hasToPattern) {
      if (typeof item.toPattern !== "string" || !item.toPattern || item.toPattern.length > 256) invalid("legal transition toPattern is invalid");
      try { new RegExp(item.toPattern, "u"); } catch { invalid("legal transition toPattern is invalid"); }
    }
    const requires = (item.requires ?? []).map((requirement) => {
      exact(requirement, ["field", "from", "to"], "legal transition requirement");
      requiredId(requirement.field, "transition requirement field");
      if (!Array.isArray(requirement.from) || !requirement.from.length || !Array.isArray(requirement.to) || !requirement.to.length) invalid("legal transition requirement values are invalid");
      if (requirement.field === item.field) invalid("legal transition may not require itself");
      return structuredClone(requirement);
    });
    return structuredClone({ ...item, requires });
  });
}

function transitionTargetMatches(transition, value) {
  if (Object.hasOwn(transition, "toPattern")) return typeof value === "string" && new RegExp(transition.toPattern, "u").test(value);
  return transition.to.some((candidate) => stableJson(candidate) === stableJson(value));
}

function stringArray(value, label) {
  if (!Array.isArray(value)) invalid(`${label} is invalid`);
  const result = [...new Set(value.map((item) => requiredId(item, label)))];
  return result;
}
function requiredId(value, label) { if (typeof value !== "string" || !ID.test(value)) invalid(`${label} is invalid`); return value; }
function exact(value, fields, label) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) invalid(`${label} fields are invalid`); }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function stableJson(value) { return canonicalJson(value); }
function digest(value) { return crypto.createHash("sha256").update(value, "utf8").digest("hex"); }
function invalid(message, code = "ENTRY_ACTION_CONTRACT_INVALID") { throw Object.assign(new Error(message), { code }); }
