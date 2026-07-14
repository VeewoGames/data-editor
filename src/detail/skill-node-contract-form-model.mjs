import { createSkillNodeContractRegistryAdapter } from "./node-schema-registry.mjs";
import { buildChargeDerivedSummary, resolveChargeDerivedState } from "./skill-node-derived-rules.mjs";

export function createSkillNodeContractFormModel(editorState) {
  if (!editorState?.canEdit || editorState.status !== "ready" || !editorState.contract) {
    return blockedFormModel(editorState?.status ?? "error", editorState?.error ?? null);
  }
  const adapter = createSkillNodeContractRegistryAdapter(editorState.contract);
  return Object.freeze({
    status: "ready",
    canEdit: true,
    error: null,
    resolveNestedNodeSchema: adapter.resolveNestedNodeSchema,
    projectFieldStates(schema, value, context = {}) {
      const conditionValue = buildConditionValue(value, context);
      const chargeState = resolveChargeDerivedState(editorState.contract, context?.rootValue);
      const chargeSelection = chargeState && schema.title === "selection.entity";
      return schema.fields.map((field) => ({
        field,
        visible: (!chargeSelection || ["distance", "relations"].includes(field.fieldName))
          && (field.visibleWhen == null || evaluateNodeFieldCondition(field.visibleWhen, conditionValue)),
        disabled: field.readonly === true
          || (field.disabledWhen != null && evaluateNodeFieldCondition(field.disabledWhen, conditionValue)),
        readonly: field.readonly === true,
      }));
    },
    canSwitchDiscriminator(schema, context = {}) {
      return !(schema.title === "selection.entity" && resolveChargeDerivedState(editorState.contract, context?.rootValue));
    },
    getDerivedRuleSummary(schema, context = {}) {
      return schema.title === "selection.entity"
        ? buildChargeDerivedSummary(editorState.contract, context?.rootValue)
        : [];
    },
    evaluateConstraints(schema, value, context = {}) {
      const conditionValue = buildConditionValue(value, context);
      const targeting = resolveTargeting(value, context);
      const derived = adapter.deriveNodeConsumes(context?.rootValue?.nodes ?? [], targeting);
      const diagnostics = (schema.constraints ?? [])
        .filter((constraint) => constraint.when == null || evaluateNodeFieldCondition(constraint.when, conditionValue))
        .filter((constraint) => violatesConstraint(constraint, conditionValue, { targeting, consumes: derived.consumes }))
        .map((constraint) => constraintDiagnostic(constraint, context, value));
      const affectsState = resolveAffectsState(targeting, derived.consumes);
      return {
        valid: diagnostics.length === 0,
        diagnostics,
        consumes: derived.consumes,
        consumerEntries: derived.entries,
        affectsMode: affectsState.mode,
        effectiveAffects: affectsState.value,
      };
    },
  });
}

function buildConditionValue(value, context) {
  const targeting = resolveTargeting(value, context);
  const selection = context?.selection ?? targeting?.selection ?? value?.selection;
  return selection == null ? value : { ...value, selection };
}

function resolveTargeting(value, context) {
  return context?.targeting
    ?? context?.rootValue?.nodes?.find?.((node) => node?.type === "targeting")
    ?? (value?.type === "targeting" ? value : null);
}

export function evaluateNodeFieldCondition(condition, value) {
  if (Array.isArray(condition)) return condition.every((item) => evaluateNodeFieldCondition(item, value));
  if (!condition || typeof condition !== "object") return true;
  const operator = condition.operator;
  if (operator === "all") return condition.conditions.every((item) => evaluateNodeFieldCondition(item, value));
  if (operator === "any") return condition.conditions.some((item) => evaluateNodeFieldCondition(item, value));
  if (operator === "none") return !condition.conditions.some((item) => evaluateNodeFieldCondition(item, value));
  const actual = readFieldPath(value, condition.fieldName);
  if (operator === "equals") return Object.is(actual, condition.value);
  if (operator === "not_equals") return !Object.is(actual, condition.value);
  if (operator === "in") return condition.values.includes(actual);
  if (operator === "not_in") return !condition.values.includes(actual);
  if (operator === "truthy") return Boolean(actual);
  if (operator === "falsy") return !actual;
  return false;
}

function blockedFormModel(status, error) {
  return Object.freeze({
    status,
    canEdit: false,
    error,
    resolveNestedNodeSchema(context) {
      return {
        kind: "unsupported",
        lookupKey: "skill-node-contract:blocked",
        reason: error?.message ?? `Skill node contract editor is blocked (${status}).`,
        context,
      };
    },
    projectFieldStates() {
      return [];
    },
    canSwitchDiscriminator() {
      return false;
    },
    getDerivedRuleSummary() {
      return [];
    },
    evaluateConstraints() {
      return {
        valid: false,
        diagnostics: [{ code: "SKILL_NODE_CONTRACT_BLOCKED", fieldPath: "nodes" }],
        consumes: [],
        consumerEntries: [],
        affectsMode: "none",
        effectiveAffects: null,
      };
    },
  });
}

function readFieldPath(value, fieldName) {
  return String(fieldName ?? "").split(".").reduce((current, segment) => current?.[segment], value);
}

function violatesConstraint(constraint, value, runtime) {
  const values = (constraint.fieldNames ?? []).map((fieldName) => readFieldPath(value, fieldName));
  switch (constraint.operator) {
    case "less_than_or_equal":
      return values[0] != null && values[1] != null && values[0] > values[1];
    case "non_empty_array":
      return values[0] != null && (!Array.isArray(values[0]) || values[0].length === 0);
    case "number_min":
      return values[0] != null && (!Number.isFinite(values[0]) || values[0] < constraint.value);
    case "number_max":
      return values[0] != null && (!Number.isFinite(values[0]) || values[0] > constraint.value);
    case "integer_min":
      return values[0] != null && (!Number.isInteger(values[0]) || values[0] < constraint.value);
    case "integer_max":
      return values[0] != null && (!Number.isInteger(values[0]) || values[0] > constraint.value);
    case "allowed_values":
      return values[0] != null && !constraint.value.includes(values[0]);
    case "odd_integer":
      return values[0] != null && (!Number.isInteger(values[0]) || values[0] % 2 === 0);
    case "offset_pair_integers":
      return values[0] != null && (!Array.isArray(values[0]) || values[0].some((pair) =>
        !Array.isArray(pair) || pair.length !== 2 || pair.some((item) => !Number.isInteger(item))));
    case "affects_required_for_entity_consumer":
      return runtime.consumes.includes("entities")
        && runtime.targeting?.selection?.type !== "entity"
        && !hasExplicitAffects(runtime.targeting);
    case "affects_forbidden_for_cells_only_consumer":
      return runtime.consumes.includes("cells")
        && !runtime.consumes.includes("entities")
        && hasExplicitAffects(runtime.targeting);
    case "direction_affects_requires_area":
      return runtime.targeting?.selection?.type === "direction"
        && hasExplicitAffects(runtime.targeting)
        && runtime.targeting?.area == null;
    default:
      if (constraint.kind === "required") return values[0] == null || values[0] === "";
      return false;
  }
}

function constraintDiagnostic(constraint, context, value) {
  const basePath = context?.fieldPath
    ?? (value?.type === "targeting" ? "targeting" : "");
  const fieldName = constraint.fieldNames?.at(constraint.operator === "less_than_or_equal" ? -1 : 0) ?? "";
  return {
    code: constraint.code,
    fieldPath: [basePath, fieldName].filter(Boolean).join("."),
  };
}

function resolveAffectsState(targeting, consumes) {
  if (!targeting) return { mode: "none", value: null };
  if (!consumes.includes("entities")) {
    return { mode: hasExplicitAffects(targeting) ? "forbidden" : "none", value: null };
  }
  if (hasExplicitAffects(targeting)) return { mode: "explicit", value: structuredClone(targeting.affects) };
  if (targeting.selection?.type !== "entity") return { mode: "required", value: null };
  const value = {};
  for (const fieldName of ["relations", "entity_types"]) {
    if (Array.isArray(targeting.selection[fieldName])) value[fieldName] = [...targeting.selection[fieldName]];
  }
  return { mode: "inherit_selection", value };
}

function hasExplicitAffects(targeting) {
  return targeting?.affects != null
    && typeof targeting.affects === "object"
    && !Array.isArray(targeting.affects)
    && Object.keys(targeting.affects).length > 0;
}
