export function createDefaultFilterRule(field, fieldType, rules) {
  if (fieldType === "Checkbox") {
    return { kind: "rule", id: createFilterId(field, rules), field, operator: "is" };
  }
  if (fieldType === "Multi-select" || fieldType === "Select" || fieldType === "Relation") {
    return { kind: "rule", id: createFilterId(field, rules), field, operator: "contains", value: [] };
  }
  return { kind: "rule", id: createFilterId(field, rules), field, operator: "contains", value: "" };
}

export function withRules(filters, rules) {
  return {
    topLevelRules: Array.isArray(rules) ? rules : [],
    advancedRoot: filters?.advancedRoot ?? null,
  };
}

function createFilterId(field, rules) {
  const safeField = field.replace(/\s+/g, "_");
  const baseId = `filter:${safeField}`;
  if (!rules.some((rule) => rule.id === baseId)) return baseId;
  let index = 2;
  while (rules.some((rule) => rule.id === `${baseId}:${index}`)) index += 1;
  return `${baseId}:${index}`;
}
