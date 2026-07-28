import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

const TYPES = new Set(["string", "number", "boolean", "object", "array"]);
const UNIQUE_SCOPES = new Set(["none", "collection"]);
const VALIDATORS = Object.freeze({
  non_empty_string(value) { return typeof value === "string" && value.trim().length > 0; },
  any() { return true; },
});

export class EntryActionPolicyError extends Error {
  constructor(code, message) { super(message); this.name = "EntryActionPolicyError"; this.code = code; }
}

export function validateEntryActionPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value, ["version", "targets"]) || value.version !== 1 || !Array.isArray(value.targets) || value.targets.length === 0) fail("ENTRY_ACTION_POLICY_INVALID", "Policy must be version 1 with at least one target.");
  const seen = new Set();
  const targets = value.targets.map((target) => {
    if (!target || typeof target !== "object" || Array.isArray(target) || !exactKeys(target, ["file", "collection", "writableFields"])) fail("ENTRY_ACTION_POLICY_INVALID", "Policy target must be an object.");
    const file = required(target.file, "target.file"); const collection = required(target.collection, "target.collection");
    const key = `${file}\u0000${collection}`; if (seen.has(key)) fail("ENTRY_ACTION_POLICY_INVALID", "Policy targets must be unique."); seen.add(key);
    if (!target.writableFields || typeof target.writableFields !== "object" || Array.isArray(target.writableFields) || Object.keys(target.writableFields).length === 0) fail("ENTRY_ACTION_POLICY_INVALID", "Policy target requires writableFields.");
    const writableFields = Object.fromEntries(Object.entries(target.writableFields).map(([name, rule]) => [required(name, "field name"), normalizeField(rule)]));
    return { file, collection, writableFields };
  });
  return { version: 1, targets };
}

export async function loadEntryActionPolicy(file) {
  let parsed;
  try { parsed = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") fail("ENTRY_ACTION_POLICY_MISSING", "Entry-action writeback policy is missing."); fail("ENTRY_ACTION_POLICY_INVALID", "Entry-action writeback policy is unreadable."); }
  return validateEntryActionPolicy(parsed);
}

export function authorityDigest(policy) {
  return crypto.createHash("sha256").update(canonicalJson(validateEntryActionPolicy(policy))).digest("hex");
}

export function validateAuthorizedPatch({ policy, file, collection, field, value }) {
  const target = validateEntryActionPolicy(policy).targets.find((item) => item.file === file && item.collection === collection);
  if (!target) fail("ENTRY_ACTION_POLICY_TARGET_DENIED", "Policy does not authorize this target.");
  const rule = target.writableFields[field];
  if (!rule) fail("ENTRY_ACTION_POLICY_FIELD_DENIED", "Policy does not authorize this field.");
  if (value === null) { if (!rule.nullable) fail("ENTRY_ACTION_POLICY_VALUE_DENIED", "Policy does not allow null."); return rule; }
  if (typeof value !== rule.type || (rule.type === "array" && !Array.isArray(value)) || (rule.type === "object" && (Array.isArray(value) || value === null))) fail("ENTRY_ACTION_POLICY_VALUE_DENIED", "Policy value type is denied.");
  if (!VALIDATORS[rule.validator](value)) fail("ENTRY_ACTION_POLICY_VALUE_DENIED", "Policy validator rejected the value.");
  return rule;
}

function normalizeField(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value, ["type", "nullable", "uniqueScope", "validator"]) || !TYPES.has(value.type) || typeof value.nullable !== "boolean" || !UNIQUE_SCOPES.has(value.uniqueScope) || !Object.hasOwn(VALIDATORS, value.validator)) fail("ENTRY_ACTION_POLICY_INVALID", "Policy writable field schema is invalid.");
  return { type: value.type, nullable: value.nullable, uniqueScope: value.uniqueScope, validator: value.validator };
}
function required(value, label) { if (typeof value !== "string" || !value.trim()) fail("ENTRY_ACTION_POLICY_INVALID", `${label} is required.`); return value.trim(); }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function exactKeys(value, keys) { const actual = Object.keys(value); return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function fail(code, message) { throw new EntryActionPolicyError(code, message); }
