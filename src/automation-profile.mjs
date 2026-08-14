import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProjectContext, displayProjectPath } from "./project-context.mjs";
import { normalizeSharedViewIcon } from "./view/shared-view-normalize.mjs";

const validRuleIdPattern = /^[a-z0-9_-]+$/;
const maxRuntimeTimeoutMs = 2_147_483_647;
const profileSaveLocks = new Map();
export const defaultTextArtifactPolicy = Object.freeze({
  allowCreate: true,
  allowUpdate: true,
  maxBytes: 262144,
});

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
    execution: rule.execution,
    contractId: rule.contractId,
    ...(rule.createAuthority ? { createAuthority: rule.createAuthority } : {}),
    ...(rule.runtime ? { runtime: rule.runtime } : {}),
  };
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function automationProfileRuleDigest(rule) {
  return rawRuleDigest(rule);
}

export async function loadAutomationProfile(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  try {
    const text = await readFile(profilePath(context), "utf8");
    return { ...readAutomationProfileDocument(JSON.parse(text)), etag: profileEtag(text) };
  } catch (error) {
    if (error?.code === "ENOENT") return emptyAutomationProfile();
    throw error;
  }
}

export async function patchAutomationProfileRule(projectContextOrRoot, ruleId, replacement, expectedEtag, expectedRuleDigest) {
  const context = createProjectContext(projectContextOrRoot);
  const target = profilePath(context);
  const normalizedId = normalizeRequiredString(ruleId, "Entry action rule id");
  return withProfileSaveLock(target, async () => {
    const current = await readFile(target, "utf8");
    if (expectedEtag !== profileEtag(current)) throw staleProfileError();
    const document = JSON.parse(current);
    if (!document || typeof document !== "object" || Array.isArray(document) || !Array.isArray(document.rules)) throw new Error("Automation profile rules must be an array");
    const index = document.rules.findIndex((item) => item && typeof item === "object" && !Array.isArray(item) && item.id === normalizedId);
    if (index < 0) throw Object.assign(new Error("Automation profile rule was not found."), { code: "AUTOMATION_PROFILE_RULE_NOT_FOUND" });
    if (expectedRuleDigest !== rawRuleDigest(document.rules[index])) throw staleRuleError();
    const seenIds = new Set(document.rules.filter((_, itemIndex) => itemIndex !== index).map((item) => item?.id).filter((item) => typeof item === "string"));
    document.rules[index] = normalizeRule(replacement, seenIds);
    const text = `${JSON.stringify(document, null, 2)}\n`;
    await writeFile(target, text, "utf8");
    return { path: displayProjectPath(context, target), etag: profileEtag(text), ruleDigest: rawRuleDigest(document.rules[index]) };
  });
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

function readAutomationProfileDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.rules)) return { rules: [], ruleIssues: [] };
  const rules = [];
  const ruleIssues = [];
  const seenIds = new Set();
  for (const rawRule of value.rules) {
    try {
      rules.push(normalizeRule(rawRule, seenIds));
    } catch (error) {
      const ruleId = rawRule && typeof rawRule === "object" && !Array.isArray(rawRule) && typeof rawRule.id === "string" ? rawRule.id : null;
      ruleIssues.push({ ruleId, rawRule, rawDigest: rawRuleDigest(rawRule), issues: [error.message ?? String(error)] });
    }
  }
  return { rules, ruleIssues };
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
  const allowedKeys = new Set(["id", "label", "icon", "enabled", "targets", "payload", "execution", "contractId", "createAuthority", "runtime"]);
  for (const key of Object.keys(value)) if (!allowedKeys.has(key)) throw new Error(`Unsupported entry action rule field: ${key}`);
  const id = normalizeRequiredString(value.id, "Entry action rule id");
  validateRuleId(id);
  if (seenIds.has(id)) throw new Error(`Duplicate entry action rule id: ${id}`);
  seenIds.add(id);
  const label = normalizeRequiredString(value.label, `Entry action rule "${id}" label`);
  const icon = normalizeIcon(value.icon, id);
  const enabled = normalizeBoolean(value.enabled, true);
  const targets = normalizeTargets(value.targets, id);
  const payload = normalizePayload(value.payload, id);
  const execution = normalizeExecution(value.execution, id);
  const contractId = normalizeRequiredString(value.contractId, `Entry action rule "${id}" contractId`);
  const createAuthority = normalizeCreateAuthority(value.createAuthority, id, contractId);
  const runtime = normalizeRuntime(value.runtime, id);
  return { id, label, icon, enabled, targets, payload, execution, contractId, ...(createAuthority ? { createAuthority } : {}), ...(runtime ? { runtime } : {}) };
}

function normalizeExecution(value, ruleId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Entry action rule "${ruleId}" execution is required`);
  const keys = Object.keys(value).sort();
  const expectedKeys = ["advancedExecution", "kind", "resultPolicy"];
  const workspaceKeys = ["advancedExecution", "kind", "resultPolicy", "workspaceMode"];
  const basicKeys = ["kind", "resultPolicy"];
  if (keys.join(",") !== expectedKeys.join(",") && keys.join(",") !== basicKeys.join(",") && keys.join(",") !== workspaceKeys.join(",") && keys.join(",") !== ["kind", "resultPolicy", "workspaceMode"].join(",")) throw new Error(`Entry action rule "${ruleId}" execution fields are invalid`);
  const kind = normalizeRequiredEnum(value.kind, ["proposal", "project-skill"], `Entry action rule "${ruleId}" execution.kind`);
  const resultPolicy = normalizeRequiredEnum(value.resultPolicy, ["proposal", "result-only"], `Entry action rule "${ruleId}" execution.resultPolicy`);
  const valid = kind === "proposal" ? resultPolicy === "proposal" : true;
  if (!valid) throw new Error(`Entry action rule "${ruleId}" execution combination is invalid`);
  if (kind !== "project-skill" && value.workspaceMode != null) throw new Error(`Entry action rule "${ruleId}" execution.workspaceMode is unavailable for this execution kind`);
  const workspaceMode = kind === "project-skill" ? normalizeOptionalWorkspaceMode(value.workspaceMode, ruleId) : null;
  const advancedExecution = value.advancedExecution == null ? null : normalizeAdvancedExecution(value.advancedExecution, ruleId, kind, resultPolicy, workspaceMode ?? "snapshot");
  return { kind, resultPolicy, ...(workspaceMode ? { workspaceMode } : {}), ...(advancedExecution ? { advancedExecution } : {}) };
}

function normalizeOptionalWorkspaceMode(value, ruleId) {
  if (value == null || value === "") return "snapshot";
  return normalizeRequiredEnum(value, ["snapshot", "project-write"], `Entry action rule "${ruleId}" execution.workspaceMode`);
}

function normalizeAdvancedExecution(value, ruleId, kind, resultPolicy, workspaceMode) {
  if (kind !== "project-skill" || !["proposal", "result-only"].includes(resultPolicy)) throw new Error(`Entry action rule "${ruleId}" advancedExecution is unavailable for this result policy`);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Entry action rule "${ruleId}" advancedExecution fields are invalid`);
  const keys = Object.keys(value).sort();
  if (!["preflightId", "projectInput", "preflightId,projectInput"].includes(keys.join(","))) throw new Error(`Entry action rule "${ruleId}" advancedExecution fields are invalid`);
  if (workspaceMode === "project-write" && value.projectInput != null) throw new Error(`Entry action rule "${ruleId}" projectInput is unavailable in project-write mode`);
  const legacyProjectInput = value.projectInput == null ? null : normalizeProjectInput(value.projectInput, ruleId);
  const projectInput = legacyProjectInput ? { paths: legacyProjectInput.paths } : null;
  const preflightId = value.preflightId == null || value.preflightId === ""
    ? legacyProjectInput?.preflightId ?? null
    : normalizeRequiredString(value.preflightId, `Entry action rule "${ruleId}" execution.preflightId`);
  if (!projectInput && !preflightId) throw new Error(`Entry action rule "${ruleId}" advancedExecution must configure projectInput or preflightId`);
  return { ...(projectInput ? { projectInput } : {}), ...(preflightId ? { preflightId } : {}) };
}

function normalizeProjectInput(value, ruleId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Entry action rule "${ruleId}" execution.projectInput must be an object`);
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "paths" && keys.join(",") !== "paths,preflightId") throw new Error(`Entry action rule "${ruleId}" execution.projectInput fields are invalid`);
  const paths = normalizeRequiredStringArray(value.paths, `Entry action rule "${ruleId}" execution.projectInput.paths`).map((item) => normalizeProjectInputPath(item, ruleId));
  const preflightId = value.preflightId == null || value.preflightId === ""
    ? null
    : normalizeRequiredString(value.preflightId, `Entry action rule "${ruleId}" execution.projectInput.preflightId`);
  return { paths: [...new Set(paths)], ...(preflightId ? { preflightId } : {}) };
}

function normalizeProjectInputPath(value, ruleId) {
  const normalized = value.replaceAll("\\", "/");
  if (normalized === "." || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized) || normalized.split("/").includes("..")) throw new Error(`Entry action rule "${ruleId}" execution.projectInput path is invalid: ${value}`);
  return normalized;
}

function normalizeCreateAuthority(value, ruleId, contractId) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Entry action rule "${ruleId}" createAuthority must be an object`);
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "contractId" || keys[1] !== "enabled") throw new Error(`Entry action rule "${ruleId}" createAuthority fields are invalid`);
  if (value.enabled !== true) throw new Error(`Entry action rule "${ruleId}" createAuthority.enabled must be true`);
  const createContractId = normalizeRequiredString(value.contractId, `Entry action rule "${ruleId}" createAuthority.contractId`);
  if (createContractId !== contractId) throw new Error(`Entry action rule "${ruleId}" createAuthority.contractId must match contractId`);
  return { enabled: true, contractId: createContractId };
}

function normalizeRuntime(value, ruleId) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Entry action rule "${ruleId}" runtime must be an object`);
  }
  const model = normalizeOptionalString(value.model, `Entry action rule "${ruleId}" runtime.model`);
  const reasoning = normalizeOptionalReasoning(value.reasoning, `Entry action rule "${ruleId}" runtime.reasoning`);
  const verbosity = normalizeOptionalVerbosity(value.verbosity, `Entry action rule "${ruleId}" runtime.verbosity`);
  const timeoutMs = normalizeOptionalPositiveInteger(value.timeoutMs, `Entry action rule "${ruleId}" runtime.timeoutMs`, maxRuntimeTimeoutMs);
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
    const allowedKeys = new Set(["file", "collection", "textArtifact"]);
    for (const key of Object.keys(item)) if (!allowedKeys.has(key)) throw new Error(`Unsupported entry action target field: ${key}`);
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
  if (Object.keys(value).length !== 0) throw new Error(`Entry action rule "${ruleId}" target.textArtifact fields are invalid`);
  return { textArtifact: {} };
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

function normalizeOptionalPositiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (value == null || value === "") return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  if (normalized > maximum) {
    throw new Error(`${label} must be at most ${maximum}`);
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
function rawRuleDigest(value) { return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"); }
function staleProfileError() { return Object.assign(new Error("Automation profile has changed."), { code: "AUTOMATION_PROFILE_ETAG_STALE" }); }
function staleRuleError() { return Object.assign(new Error("Automation profile rule has changed."), { code: "AUTOMATION_PROFILE_RULE_STALE" }); }
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
