import crypto from "node:crypto";
import path from "node:path";

const REQUIRED = ["version", "runId", "actionId", "sourcePath", "canonicalFileKey", "collectionPath", "rowId", "baseDocumentEtag", "automationProfileEtag", "authorityDigest", "fencingToken", "changes", "textArtifact", "summary"];
const CHANGE = ["field", "beforeExists", "before", "afterExists", "after"];
const TEXT_ARTIFACT = ["id", "path", "beforeExists", "beforeDigest", "afterContent", "afterDigest"];
const KEY = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CHANGES = 64;
const MAX_TEXT_ARTIFACT_BYTES = 1024 * 1024;

export function validateEntryActionProposal(value) {
  exact(value, REQUIRED, "proposal");
  for (const field of ["runId", "actionId", "sourcePath", "collectionPath", "rowId", "baseDocumentEtag", "automationProfileEtag", "authorityDigest", "summary"]) required(value[field], field);
  if (value.version !== 2 || !UUID.test(value.runId) || !KEY.test(value.canonicalFileKey) || !KEY.test(value.authorityDigest) || !Number.isSafeInteger(value.fencingToken) || value.fencingToken < 1) invalid("proposal identity is invalid");
  if (!Array.isArray(value.changes) || value.changes.length === 0 || value.changes.length > MAX_CHANGES) invalid(`proposal changes must contain 1-${MAX_CHANGES} items`);
  const fields = new Set();
  for (const [index, change] of value.changes.entries()) {
    exact(change, CHANGE, `proposal changes[${index}]`);
    const field = required(change.field, `changes[${index}].field`);
    if (fields.has(field)) invalid("proposal changes must use unique fields");
    fields.add(field);
    if (typeof change.beforeExists !== "boolean" || typeof change.afterExists !== "boolean") invalid("proposal change existence flags are invalid");
    if (!change.beforeExists && change.before !== null) invalid("missing before value must be null");
    if (!change.beforeExists) invalid("proposal may not add a field");
    if (!change.afterExists && change.after !== null) invalid("missing after value must be null");
    if (!change.afterExists) invalid("proposal may not remove a field");
    if (stableJson(change.before) === stableJson(change.after)) invalid("proposal changes may not be no-ops");
  }
  validateTextArtifact(value.textArtifact);
  return structuredClone(value);
}

function validateTextArtifact(value) {
  if (value === null) return;
  exact(value, TEXT_ARTIFACT, "proposal textArtifact");
  required(value.id, "textArtifact.id");
  const relativePath = required(value.path, "textArtifact.path");
  if (relativePath.includes("\\") || path.posix.isAbsolute(relativePath) || path.posix.normalize(relativePath) !== relativePath
    || relativePath === "." || relativePath.startsWith("../") || !relativePath.toLowerCase().endsWith(".md")) {
    invalid("textArtifact.path must be a normalized relative Markdown path");
  }
  if (typeof value.beforeExists !== "boolean") invalid("textArtifact.beforeExists must be boolean");
  if (value.beforeExists ? !KEY.test(value.beforeDigest) : value.beforeDigest !== null) invalid("textArtifact.beforeDigest does not match beforeExists");
  if (typeof value.afterContent !== "string" || value.afterContent.length === 0 || Buffer.byteLength(value.afterContent, "utf8") > MAX_TEXT_ARTIFACT_BYTES) {
    invalid(`textArtifact.afterContent must contain 1-${MAX_TEXT_ARTIFACT_BYTES} UTF-8 bytes`);
  }
  if (!KEY.test(value.afterDigest) || digest(value.afterContent) !== value.afterDigest) invalid("textArtifact.afterDigest does not match afterContent");
}

function exact(value, fields, label) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) invalid(`${label} schema is invalid`); }
function required(value, label) { if (typeof value !== "string" || !value.trim()) invalid(`${label} is required`); return value.trim(); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function digest(value) { return crypto.createHash("sha256").update(value, "utf8").digest("hex"); }
function invalid(message) { throw Object.assign(new Error(message), { code: "ENTRY_ACTION_PROPOSAL_INVALID" }); }
