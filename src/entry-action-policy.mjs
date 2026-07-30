import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { createProjectContext } from "./project-context.mjs";

const TEXT_ARTIFACT_TEMPLATE_TOKEN = "{value}";
const PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;

export class EntryActionPolicyError extends Error {
  constructor(code, message) { super(message); this.name = "EntryActionPolicyError"; this.code = code; }
}

export function validateEntryActionPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value, ["version", "targets", "textArtifacts"]) || value.version !== 4 || !Array.isArray(value.targets) || value.targets.length === 0 || !Array.isArray(value.textArtifacts)) fail("ENTRY_ACTION_POLICY_INVALID", "Policy must be version 4 with action-scoped targets and textArtifacts.");
  const seen = new Set();
  const targets = value.targets.map((target) => {
    if (!target || typeof target !== "object" || Array.isArray(target)
      || !(exactKeys(target, ["actionId", "file", "collection"])
        || exactKeys(target, ["actionId", "file", "collection", "rowMatch"]))) {
      fail("ENTRY_ACTION_POLICY_INVALID", "Policy target must be an object.");
    }
    const actionId = actionKey(target.actionId, "target.actionId"); const file = required(target.file, "target.file"); const collection = required(target.collection, "target.collection");
    const key = `${actionId}\u0000${file}\u0000${collection}`; if (seen.has(key)) fail("ENTRY_ACTION_POLICY_INVALID", "Policy targets must be unique per action."); seen.add(key);
    const rowMatch = normalizeRowMatch(target.rowMatch);
    return { actionId, file, collection, rowMatch };
  });
  const textArtifactIds = new Set();
  const textArtifacts = value.textArtifacts.map((artifact) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)
      || !exactKeys(artifact, ["actionId", "id", "pathTemplate", "sourceField", "allowCreate", "allowUpdate", "maxBytes"])) {
      fail("ENTRY_ACTION_POLICY_INVALID", "Policy textArtifact must be an object.");
    }
    const actionId = actionKey(artifact.actionId, "textArtifact.actionId"); const id = required(artifact.id, "textArtifact.id");
    const artifactKey = `${actionId}\u0000${id}`;
    if (textArtifactIds.has(artifactKey)) fail("ENTRY_ACTION_POLICY_INVALID", "Policy textArtifact ids must be unique per action.");
    textArtifactIds.add(artifactKey);
    const pathTemplate = normalizeTextArtifactPathTemplate(artifact.pathTemplate);
    const sourceField = required(artifact.sourceField, "textArtifact.sourceField");
    if (typeof artifact.allowCreate !== "boolean" || typeof artifact.allowUpdate !== "boolean"
      || (!artifact.allowCreate && !artifact.allowUpdate)
      || !Number.isInteger(artifact.maxBytes) || artifact.maxBytes <= 0 || artifact.maxBytes > 1024 * 1024) {
      fail("ENTRY_ACTION_POLICY_INVALID", "Policy textArtifact permissions or maxBytes are invalid.");
    }
    return {
      actionId,
      id,
      pathTemplate,
      sourceField,
      allowCreate: artifact.allowCreate,
      allowUpdate: artifact.allowUpdate,
      maxBytes: artifact.maxBytes,
    };
  });
  return { version: 4, targets, textArtifacts };
}

export async function loadEntryActionPolicy(file) {
  let parsed;
  try { parsed = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") fail("ENTRY_ACTION_POLICY_MISSING", "Entry-action writeback policy is missing."); fail("ENTRY_ACTION_POLICY_INVALID", "Entry-action writeback policy is unreadable."); }
  return validateEntryActionPolicy(parsed);
}

export function loadProjectEntryActionPolicy(projectContextOrRoot) {
  return loadEntryActionPolicy(createProjectContext(projectContextOrRoot).entryActionPolicyPath);
}

export function authorityDigest(policy) {
  return crypto.createHash("sha256").update(canonicalJson(validateEntryActionPolicy(policy))).digest("hex");
}

export function validateAuthorizedPatch({ policy, actionId, file, collection, field, value }) {
  findTarget(policy, actionId, file, collection);
  required(field, "field");
  if (value === undefined) fail("ENTRY_ACTION_POLICY_VALUE_DENIED", "Policy does not allow undefined.");
  return { uniqueScope: "none" };
}

export function validateAuthorizedRow({ policy, actionId, file, collection, row }) {
  const target = findTarget(policy, actionId, file, collection);
  if (Object.keys(target.rowMatch).length === 0) return target;
  if (!row || typeof row !== "object" || Array.isArray(row)) fail("ENTRY_ACTION_POLICY_ROW_DENIED", "Policy row predicate rejected the entry.");
  for (const [field, allowedValues] of Object.entries(target.rowMatch)) {
    if (!allowedValues.some((allowed) => canonicalJson(allowed) === canonicalJson(row[field]))) {
      fail("ENTRY_ACTION_POLICY_ROW_DENIED", "Policy row predicate rejected the entry.");
    }
  }
  return target;
}

export function validateAuthorizedTextArtifact({ policy, actionId, artifactId, path, sourceValue, beforeExists, afterContent }) {
  const normalizedActionId = actionKey(actionId, "actionId");
  const artifact = validateEntryActionPolicy(policy).textArtifacts.find((item) => item.actionId === normalizedActionId && item.id === artifactId);
  if (!artifact) fail("ENTRY_ACTION_POLICY_TEXT_ARTIFACT_DENIED", "Policy does not authorize this text artifact.");
  if (typeof sourceValue !== "string" || !PATH_SEGMENT.test(sourceValue)) fail("ENTRY_ACTION_POLICY_TEXT_ARTIFACT_DENIED", "Text artifact source value is not a safe path segment.");
  const expectedPath = artifact.pathTemplate.replace(TEXT_ARTIFACT_TEMPLATE_TOKEN, sourceValue);
  if (path !== expectedPath) fail("ENTRY_ACTION_POLICY_TEXT_ARTIFACT_DENIED", "Text artifact path does not match policy.");
  if (beforeExists ? !artifact.allowUpdate : !artifact.allowCreate) fail("ENTRY_ACTION_POLICY_TEXT_ARTIFACT_DENIED", "Policy does not authorize this text artifact operation.");
  if (typeof afterContent !== "string" || Buffer.byteLength(afterContent, "utf8") > artifact.maxBytes) fail("ENTRY_ACTION_POLICY_TEXT_ARTIFACT_DENIED", "Text artifact exceeds the policy size limit.");
  return artifact;
}

function findTarget(policy, actionId, file, collection) {
  const normalizedActionId = actionKey(actionId, "actionId");
  const target = validateEntryActionPolicy(policy).targets.find((item) => item.actionId === normalizedActionId && item.file === file && item.collection === collection);
  if (!target) fail("ENTRY_ACTION_POLICY_TARGET_DENIED", "Policy does not authorize this action target.");
  return target;
}

function normalizeRowMatch(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) fail("ENTRY_ACTION_POLICY_INVALID", "Policy rowMatch must be an object.");
  return Object.fromEntries(Object.entries(value).map(([field, allowedValues]) => {
    const name = required(field, "rowMatch field");
    if (!Array.isArray(allowedValues) || allowedValues.length === 0
      || allowedValues.some((allowed) => allowed === undefined || typeof allowed === "object")) {
      fail("ENTRY_ACTION_POLICY_INVALID", "Policy rowMatch values must be non-empty primitive arrays.");
    }
    return [name, structuredClone(allowedValues)];
  }));
}
function normalizeTextArtifactPathTemplate(value) {
  const template = required(value, "textArtifact.pathTemplate");
  if (template.includes("\\") || template.split(TEXT_ARTIFACT_TEMPLATE_TOKEN).length !== 2
    || template.startsWith("/") || template.startsWith("../") || template.includes("/../")
    || !template.toLowerCase().endsWith(".md")) {
    fail("ENTRY_ACTION_POLICY_INVALID", "Policy textArtifact.pathTemplate must be a normalized relative Markdown path with one {value} token.");
  }
  const normalized = template.split("/").filter((segment) => segment !== ".").join("/");
  if (normalized !== template) fail("ENTRY_ACTION_POLICY_INVALID", "Policy textArtifact.pathTemplate must be normalized.");
  return template;
}
function actionKey(value, label) { const actionId = required(value, label); if (!/^[a-z0-9_-]+$/.test(actionId)) fail("ENTRY_ACTION_POLICY_INVALID", `${label} is invalid.`); return actionId; }
function required(value, label) { if (typeof value !== "string" || !value.trim()) fail("ENTRY_ACTION_POLICY_INVALID", `${label} is required.`); return value.trim(); }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function exactKeys(value, keys) { const actual = Object.keys(value); return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function fail(code, message) { throw new EntryActionPolicyError(code, message); }
