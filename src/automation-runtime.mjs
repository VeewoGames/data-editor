export const defaultAutomationRuntime = Object.freeze({
  model: "gpt-5.6-terra",
  reasoning: "medium",
  verbosity: "low",
  timeoutMs: 120000,
});

export function resolveAutomationExecutionConfig({ rule, binding, defaults, systemDefaults = defaultAutomationRuntime }) {
  return {
    provider: binding.provider,
    skill: binding.skill,
    runtime: {
      model: normalizeModel(rule?.runtime?.model, defaults?.model, systemDefaults.model),
      reasoning: normalizeReasoning(rule?.runtime?.reasoning, defaults?.reasoning, systemDefaults.reasoning),
      verbosity: normalizeVerbosity(rule?.runtime?.verbosity, defaults?.verbosity, systemDefaults.verbosity),
      timeoutMs: normalizeTimeoutMs(rule?.runtime?.timeoutMs, defaults?.timeoutMs, systemDefaults.timeoutMs),
    },
  };
}

function normalizeModel(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return defaultAutomationRuntime.model;
}

function normalizeTimeoutMs(...values) {
  for (const value of values) {
    const normalized = Number(value);
    if (Number.isInteger(normalized) && normalized > 0) return normalized;
  }
  return defaultAutomationRuntime.timeoutMs;
}

function normalizeReasoning(...values) {
  return normalizeEnum(values, ["none", "low", "medium", "high", "xhigh"], defaultAutomationRuntime.reasoning);
}

function normalizeVerbosity(...values) {
  return normalizeEnum(values, ["low", "medium", "high"], defaultAutomationRuntime.verbosity);
}

function normalizeEnum(values, allowed, fallback) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (allowed.includes(normalized)) return normalized;
  }
  return fallback;
}
