import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProjectContext, displayProjectPath } from "./project-context.mjs";
import { resolveCodexSkill } from "./codex-runtime.mjs";

const allowedProviders = new Set(["codex"]);

export function emptyAutomationBindings() {
  return { version: 2, defaults: {}, bindings: {}, preflights: {} };
}

export async function loadAutomationBindings(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  try {
    const text = await readFile(bindingsPath(context), "utf8");
    return { ...normalizeAutomationBindings(JSON.parse(text)), revision: bindingsRevision(text) };
  } catch (error) {
    if (error?.code === "ENOENT") return loadLegacyAutomationBindings(context);
    throw error;
  }
}

export async function saveAutomationBindings(projectContextOrRoot, value, options = {}) {
  const context = createProjectContext(projectContextOrRoot);
  const target = bindingsPath(context);
  const normalized = validateAutomationBindings(value);
  if (options.validateRuntime === true) {
    await validateAutomationBindingsRuntime(normalized, { projectRoot: context.projectRoot });
  }
  const current = await readFile(target, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error));
  if (options.expectedRevision != null && options.expectedRevision !== bindingsRevision(current)) {
    throw Object.assign(new Error("Automation bindings have changed."), { code: "AUTOMATION_BINDINGS_REVISION_STALE" });
  }
  await mkdir(path.dirname(target), { recursive: true });
  const text = `${JSON.stringify(toDiskBindings(normalized), null, 2)}\n`;
  await writeFile(target, text, "utf8");
  return { path: displayProjectPath(context, target), revision: bindingsRevision(text) };
}

export function validateAutomationBindings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Automation bindings must be an object");
  }
  const rawBindings = value.bindings ?? value.codexBindings;
  if (!rawBindings || typeof rawBindings !== "object" || Array.isArray(rawBindings)) {
    throw new Error("Automation bindings.bindings must be an object");
  }
  return normalizeAutomationBindings(value);
}

export function normalizeAutomationBindings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyAutomationBindings();
  const rawBindings = value.bindings ?? value.codexBindings;
  if (!rawBindings || typeof rawBindings !== "object" || Array.isArray(rawBindings)) {
    return emptyAutomationBindings();
  }
  const defaults = normalizeDefaults(value.defaults);
  const bindings = {};
  for (const [ruleId, rawBinding] of Object.entries(rawBindings)) {
    const normalizedRuleId = normalizeRequiredString(ruleId, "Automation binding id");
    bindings[normalizedRuleId] = normalizeBinding(rawBinding, normalizedRuleId);
  }
  const preflights = normalizePreflights(value.preflights);
  return { version: 2, defaults, bindings, preflights };
}

async function loadLegacyAutomationBindings(context) {
  try {
    const parsed = JSON.parse(await readFile(path.resolve(context.legacyLocalAutomationBindingsPath), "utf8"));
    return normalizeAutomationBindings(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return emptyAutomationBindings();
    throw error;
  }
}

function toDiskBindings(value) {
  return { version: 2, defaults: value.defaults, codexBindings: value.bindings, preflights: value.preflights };
}

function bindingsRevision(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizePreflights(value) {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Automation bindings.preflights must be an object");
  const result = {};
  for (const [preflightId, binding] of Object.entries(value)) {
    const id = normalizeRequiredString(preflightId, "Automation preflight id");
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error(`Automation preflight "${id}" must be an object`);
    const keys = Object.keys(binding).sort();
    const allowed = new Set(["label", "description", "recommendedSkills", "interpreter", "script", "sha256", "timeoutMs"]);
    if (!keys.every((key) => allowed.has(key))) throw new Error(`Automation preflight "${id}" fields are invalid`);
    result[id] = {
      label: normalizeRequiredString(binding.label ?? id, `Automation preflight "${id}" label`),
      ...(binding.description == null || binding.description === "" ? {} : { description: normalizeRequiredString(binding.description, `Automation preflight "${id}" description`) }),
      ...(binding.recommendedSkills == null ? {} : { recommendedSkills: normalizeStringArray(binding.recommendedSkills, `Automation preflight "${id}" recommendedSkills`) }),
      interpreter: normalizeRequiredString(binding.interpreter, `Automation preflight "${id}" interpreter`),
      script: normalizeRequiredString(binding.script, `Automation preflight "${id}" script`),
      sha256: normalizeDigest(binding.sha256, id),
      timeoutMs: normalizeOptionalPositiveInteger(binding.timeoutMs, `Automation preflight "${id}" timeoutMs`),
    };
    if (result[id].timeoutMs == null || result[id].timeoutMs > 120000) throw new Error(`Automation preflight "${id}" timeoutMs must be between 1 and 120000`);
  }
  return result;
}

function normalizeStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${label} must be a string array`);
  return [...new Set(value.map((item) => item.trim()))];
}

function normalizeDigest(value, id) {
  const digest = normalizeRequiredString(value, `Automation preflight "${id}" sha256`).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Automation preflight "${id}" sha256 must be a SHA-256 hex digest`);
  return digest;
}

export async function validateAutomationBindingsRuntime(value, options = {}) {
  const normalized = validateAutomationBindings(value);
  const projectRoot = typeof options.projectRoot === "string" && options.projectRoot.trim()
    ? path.resolve(options.projectRoot)
    : null;
  for (const [ruleId, binding] of Object.entries(normalized.bindings)) {
    if (binding.provider !== "codex") continue;
    const skill = await resolveCodexSkill(binding.skill, { projectRoot });
    if (!skill.available) {
      throw new Error(`Automation binding "${ruleId}" ${skill.message}`);
    }
  }
  return normalized;
}

function normalizeBinding(value, ruleId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Automation binding "${ruleId}" must be an object`);
  }
  const allowedKeys = new Set(["provider", "skill", "enabled"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`Unsupported automation binding field: ${key}`);
  }
  const provider = normalizeRequiredString(value.provider, `Automation binding "${ruleId}" provider`);
  if (!allowedProviders.has(provider)) throw new Error(`Unsupported automation binding provider: ${provider}`);
  const skill = normalizeRequiredString(value.skill, `Automation binding "${ruleId}" skill`);
  const enabled = normalizeOptionalBoolean(value.enabled, `Automation binding "${ruleId}" enabled`, true);
  return { provider, skill, enabled };
}

function normalizeDefaults(value) {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Automation bindings.defaults must be an object");
  }
  const model = normalizeOptionalString(value.model, "Automation bindings.defaults.model");
  const reasoning = normalizeOptionalReasoning(value.reasoning, "Automation bindings.defaults.reasoning");
  const verbosity = normalizeOptionalVerbosity(value.verbosity, "Automation bindings.defaults.verbosity");
  const timeoutMs = normalizeOptionalPositiveInteger(value.timeoutMs, "Automation bindings.defaults.timeoutMs");
  return {
    ...(model != null ? { model } : {}),
    ...(reasoning != null ? { reasoning } : {}),
    ...(verbosity != null ? { verbosity } : {}),
    ...(timeoutMs != null ? { timeoutMs } : {}),
  };
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

function normalizeOptionalBoolean(value, label, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function normalizeOptionalPositiveInteger(value, label) {
  if (value == null || value === "") return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) throw new Error(`${label} must be a positive integer`);
  return normalized;
}

function normalizeOptionalReasoning(value, label) {
  if (value == null || value === "") return null;
  return normalizeRequiredEnum(value, ["none", "low", "medium", "high", "xhigh"], label);
}

function normalizeOptionalVerbosity(value, label) {
  if (value == null || value === "") return null;
  return normalizeRequiredEnum(value, ["low", "medium", "high"], label);
}

function normalizeRequiredEnum(value, allowed, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  const normalized = value.trim();
  if (!allowed.includes(normalized)) throw new Error(`${label} must be one of: ${allowed.join(", ")}`);
  return normalized;
}

function bindingsPath(context) {
  return path.resolve(context.localAutomationBindingsPath);
}
