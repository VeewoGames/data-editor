import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProjectContext, displayProjectPath } from "./project-context.mjs";
import { normalizeSharedViewIcon } from "./view/shared-view-normalize.mjs";

const validRuleIdPattern = /^[a-z0-9_-]+$/;
const profileSaveLocks = new Map();

export function emptyAutomationProfile() {
  return { rules: [], etag: null };
}

export function ruleAuthorityDigest(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new Error("Entry action authority rule is invalid");
  const value = {
    id: rule.id,
    enabled: rule.enabled,
    targets: rule.targets,
    payload: rule.payload,
    ...(rule.runtime ? { runtime: rule.runtime } : {}),
  };
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export async function loadAutomationProfile(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  try {
    const text = await readFile(profilePath(context), "utf8");
    return { ...normalizeAutomationProfile(JSON.parse(text)), etag: profileEtag(text) };
  } catch (error) {
    if (error?.code === "ENOENT") return emptyAutomationProfile();
    throw error;
  }
}

export async function saveAutomationProfile(projectContextOrRoot, profile, expectedEtag = null) {
  const context = createProjectContext(projectContextOrRoot);
  const target = profilePath(context);
  const normalized = validateAutomationProfile(profile);
  return withProfileSaveLock(target, async () => {
    const current = await readFile(target, "utf8").catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (expectedEtag != null && expectedEtag !== profileEtag(current ?? "")) throw Object.assign(new Error("Automation profile has changed."), { code: "AUTOMATION_PROFILE_ETAG_STALE" });
    await mkdir(path.dirname(target), { recursive: true });
    const text = `${JSON.stringify(normalized, null, 2)}\n`;
    await writeFile(target, text, "utf8");
    return { path: displayProjectPath(context, target), etag: profileEtag(text) };
  });
}

export function validateAutomationProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Automation profile must be an object");
  }
  if (!Array.isArray(value.rules)) throw new Error("Automation profile rules must be an array");
  return {
    rules: normalizeRules(value.rules),
  };
}

export function normalizeAutomationProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyAutomationProfile();
  return {
    rules: normalizeRules(value.rules),
  };
}

function normalizeRules(value) {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set();
  return value.map((item) => normalizeRule(item, seenIds));
}

function normalizeRule(value, seenIds) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Entry action rule must be an object");
  }
  const id = normalizeRequiredString(value.id, "Entry action rule id");
  validateRuleId(id);
  if (seenIds.has(id)) throw new Error(`Duplicate entry action rule id: ${id}`);
  seenIds.add(id);
  const label = normalizeRequiredString(value.label, `Entry action rule "${id}" label`);
  const icon = normalizeIcon(value.icon, id);
  const enabled = normalizeBoolean(value.enabled, true);
  const targets = normalizeTargets(value.targets, id);
  const payload = normalizePayload(value.payload, id);
  const runtime = normalizeRuntime(value.runtime, id);
  return { id, label, icon, enabled, targets, payload, ...(runtime ? { runtime } : {}) };
}

function normalizeRuntime(value, ruleId) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Entry action rule "${ruleId}" runtime must be an object`);
  }
  const model = normalizeOptionalString(value.model, `Entry action rule "${ruleId}" runtime.model`);
  const reasoning = normalizeOptionalReasoning(value.reasoning, `Entry action rule "${ruleId}" runtime.reasoning`);
  const verbosity = normalizeOptionalVerbosity(value.verbosity, `Entry action rule "${ruleId}" runtime.verbosity`);
  const timeoutMs = normalizeOptionalPositiveInteger(value.timeoutMs, `Entry action rule "${ruleId}" runtime.timeoutMs`);
  if (model == null && reasoning == null && verbosity == null && timeoutMs == null) {
    return null;
  }
  return {
    ...(model != null ? { model } : {}),
    ...(reasoning != null ? { reasoning } : {}),
    ...(verbosity != null ? { verbosity } : {}),
    ...(timeoutMs != null ? { timeoutMs } : {}),
  };
}

function normalizeTargets(value, ruleId) {
  if (Array.isArray(value)) {
    return normalizeTargetPairs(value, ruleId);
  }
  if (!value || typeof value !== "object") {
    throw new Error(`Entry action rule "${ruleId}" targets must be an array`);
  }
  const files = normalizeRequiredStringArray(value.files, `Entry action rule "${ruleId}" targets.files`);
  const collections = normalizeRequiredStringArray(value.collections, `Entry action rule "${ruleId}" targets.collections`);
  return dedupeTargetPairs(
    files.flatMap((file) => collections.map((collection) => ({ file, collection }))),
    ruleId,
  );
}

function normalizeTargetPairs(value, ruleId) {
  const result = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Entry action rule "${ruleId}" target must be an object`);
    }
    result.push({
      file: normalizeRequiredString(item.file, `Entry action rule "${ruleId}" target.file`),
      collection: normalizeRequiredString(item.collection, `Entry action rule "${ruleId}" target.collection`),
      ...normalizeTextArtifact(item.textArtifact, ruleId),
    });
  }
  return dedupeTargetPairs(result, ruleId);
}

function dedupeTargetPairs(value, ruleId) {
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const key = `${item.file}\u0000${item.collection}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  if (result.length === 0) {
    throw new Error(`Entry action rule "${ruleId}" targets must contain at least one value`);
  }
  return result;
}

function normalizeTextArtifact(value, ruleId) {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Entry action rule "${ruleId}" target.textArtifact must be an object`);
  const keys = Object.keys(value).sort();
  const required = ["allowCreate", "allowUpdate", "maxBytes", "pathTemplate", "sourceField"];
  if (keys.length !== required.length || required.some((key) => !Object.hasOwn(value, key))) throw new Error(`Entry action rule "${ruleId}" target.textArtifact fields are invalid`);
  const pathTemplate = normalizeRequiredString(value.pathTemplate, `Entry action rule "${ruleId}" target.textArtifact.pathTemplate`);
  if (pathTemplate.includes("\\") || path.posix.isAbsolute(pathTemplate) || path.posix.normalize(pathTemplate) !== pathTemplate || !pathTemplate.endsWith(".md") || (pathTemplate.match(/\{value\}/g) ?? []).length !== 1) throw new Error(`Entry action rule "${ruleId}" target.textArtifact.pathTemplate is invalid`);
  const sourceField = normalizeRequiredString(value.sourceField, `Entry action rule "${ruleId}" target.textArtifact.sourceField`);
  const maxBytes = normalizeOptionalPositiveInteger(value.maxBytes, `Entry action rule "${ruleId}" target.textArtifact.maxBytes`);
  if (maxBytes == null || typeof value.allowCreate !== "boolean" || typeof value.allowUpdate !== "boolean") throw new Error(`Entry action rule "${ruleId}" target.textArtifact permissions are invalid`);
  return { textArtifact: { pathTemplate, sourceField, allowCreate: value.allowCreate, allowUpdate: value.allowUpdate, maxBytes } };
}

function normalizePayload(value, ruleId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Entry action rule "${ruleId}" payload must be an object`);
  }
  const allowedKeys = new Set(["includeRow", "includeNeighbors"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`Unsupported entry action payload field: ${key}`);
  }
  return {
    includeRow: normalizeBoolean(value.includeRow, true),
    includeNeighbors: normalizeBoolean(value.includeNeighbors, true),
  };
}

function normalizeIcon(value, ruleId) {
  const icon = normalizeRequiredString(value, `Entry action rule "${ruleId}" icon`);
  if (normalizeSharedViewIcon(icon) !== icon) {
    throw new Error(`Unsupported entry action icon: ${icon}`);
  }
  return icon;
}

function normalizeRequiredStringArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const normalized = normalizeRequiredString(item, label);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  if (result.length === 0) throw new Error(`${label} must contain at least one value`);
  return result;
}

function normalizeRequiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function normalizeOptionalString(value, label) {
  if (value == null) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function validateRuleId(id) {
  if (!validRuleIdPattern.test(id)) {
    throw new Error(`Entry action rule id must use lowercase letters, numbers, "_" or "-": ${id}`);
  }
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeOptionalPositiveInteger(value, label) {
  if (value == null || value === "") return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return normalized;
}

function normalizeOptionalReasoning(value, label) {
  if (value == null || value === "") return null;
  const normalized = normalizeRequiredEnum(value, ["none", "low", "medium", "high", "xhigh"], label);
  return normalized;
}

function normalizeOptionalVerbosity(value, label) {
  if (value == null || value === "") return null;
  return normalizeRequiredEnum(value, ["low", "medium", "high"], label);
}

function normalizeRequiredEnum(value, allowed, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  const normalized = value.trim();
  if (!allowed.includes(normalized)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return normalized;
}

function profilePath(context) {
  return path.resolve(context.automationProfilePath);
}
function profileEtag(text) { return `"${crypto.createHash("sha256").update(text, "utf8").digest("hex")}"`; }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
async function withProfileSaveLock(key, task) {
  const previous = profileSaveLocks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  profileSaveLocks.set(key, current);
  await previous;
  try { return await task(); }
  finally { release(); if (profileSaveLocks.get(key) === current) profileSaveLocks.delete(key); }
}
