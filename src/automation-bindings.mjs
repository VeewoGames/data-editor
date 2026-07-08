import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProjectContext, displayProjectPath } from "./project-context.mjs";
import { resolveCodexSkill } from "./codex-runtime.mjs";

const allowedProviders = new Set(["codex"]);

export function emptyAutomationBindings() {
  return { bindings: {} };
}

export async function loadAutomationBindings(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  try {
    const parsed = JSON.parse(await readFile(bindingsPath(context), "utf8"));
    return normalizeAutomationBindings(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return emptyAutomationBindings();
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
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return { path: displayProjectPath(context, target) };
}

export function validateAutomationBindings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Automation bindings must be an object");
  }
  const rawBindings = value.bindings;
  if (!rawBindings || typeof rawBindings !== "object" || Array.isArray(rawBindings)) {
    throw new Error("Automation bindings.bindings must be an object");
  }
  return normalizeAutomationBindings(value);
}

export function normalizeAutomationBindings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyAutomationBindings();
  const rawBindings = value.bindings;
  if (!rawBindings || typeof rawBindings !== "object" || Array.isArray(rawBindings)) {
    return emptyAutomationBindings();
  }
  const bindings = {};
  for (const [ruleId, rawBinding] of Object.entries(rawBindings)) {
    const normalizedRuleId = normalizeRequiredString(ruleId, "Automation binding id");
    bindings[normalizedRuleId] = normalizeBinding(rawBinding, normalizedRuleId);
  }
  return { bindings };
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

function normalizeRequiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function normalizeOptionalBoolean(value, label, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function bindingsPath(context) {
  return path.resolve(context.localAutomationBindingsPath);
}
