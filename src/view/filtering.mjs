export function attachRowIndexes(rows) {
  return rows.map((row, index) => {
    const copy = { ...row };
    copyHiddenRuntimeProperty(row, copy, "__viewRowId");
    Object.defineProperty(copy, "__rowIndex", {
      value: typeof row?.__rowIndex === "number" ? row.__rowIndex : index,
      enumerable: false,
      configurable: true,
    });
    return copy;
  });
}

const discreteScalarFieldTypes = new Set(["Select", "Relation"]);

export function applyViewFilters(rows, query, filters, fieldTypes = {}) {
  const normalizedQuery = normalizeText(query).toLowerCase();
  const topLevelRules = Array.isArray(filters?.topLevelRules)
    ? filters.topLevelRules
    : Array.isArray(filters?.rules)
      ? filters.rules
      : [];
  const advancedRoot = filters?.advancedRoot ?? null;
  if (!normalizedQuery && topLevelRules.length === 0 && !advancedRoot) return rows;
  const indexedRows = attachRowIndexes(rows);

  return indexedRows.filter((row) => {
    if (normalizedQuery && !rowMatchesQuery(row, normalizedQuery)) return false;
    if (!topLevelRules.every((rule) => matchNode(row, rule, fieldTypes))) return false;
    return advancedRoot ? matchNode(row, advancedRoot, fieldTypes) : true;
  });
}

function matchNode(row, node, fieldTypes = {}) {
  if (!node || typeof node !== "object") return true;
  if (node.kind === "group") return matchGroupNode(row, node, fieldTypes);
  return matchesFilterRule(row, node, fieldTypes);
}

function matchGroupNode(row, group, fieldTypes = {}) {
  const children = Array.isArray(group?.children) ? group.children : [];
  if (group?.op === "or") return children.some((child) => matchNode(row, child, fieldTypes));
  return children.every((child) => matchNode(row, child, fieldTypes));
}

export function matchesFilterRule(row, rule, fieldTypes = {}) {
  if (!rule || typeof rule !== "object") return true;
  const value = row?.[rule.field];
  const fieldType = fieldTypes?.[rule.field];
  switch (rule.operator) {
    case "contains":
      if (!hasExpectedValue(rule.value)) return true;
      return containsValue(value, rule.value, fieldType);
    case "does_not_contain":
      if (!hasExpectedValue(rule.value)) return true;
      return !containsValue(value, rule.value, fieldType);
    case "is_empty":
      return isEmptyValue(value);
    case "is_not_empty":
      return !isEmptyValue(value);
    case "is":
      if (!hasExpectedValue(rule.value)) return true;
      return valuesEqual(value, rule.value);
    case "is_not":
      if (!hasExpectedValue(rule.value)) return true;
      return !valuesEqual(value, rule.value);
    default:
      return true;
  }
}

function hasExpectedValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value != null && value !== "";
}

function rowMatchesQuery(row, query) {
  return Object.entries(row).some(([key, value]) => {
    if (key === "__rowIndex") return false;
    return normalizeText(value).toLowerCase().includes(query);
  });
}

function containsValue(value, expected, fieldType) {
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  if (Array.isArray(value)) {
    return expectedValues.some((item) => value.some((entry) => valuesEqual(entry, item)));
  }
  if (discreteScalarFieldTypes.has(fieldType)) {
    return expectedValues.some((item) => valuesEqual(value, item));
  }
  const actual = normalizeText(value).toLowerCase();
  return expectedValues.some((item) => actual.includes(normalizeText(item).toLowerCase()));
}

function valuesEqual(left, right) {
  if (typeof left === "boolean" || typeof right === "boolean") {
    return normalizeBoolean(left) === normalizeBoolean(right);
  }
  return normalizeText(left).toLowerCase() === normalizeText(right).toLowerCase();
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return Boolean(value);
}

function isEmptyValue(value) {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

function normalizeText(value) {
  if (Array.isArray(value)) return value.join(" ");
  if (value == null) return "";
  return String(value);
}

function copyHiddenRuntimeProperty(source, target, key) {
  if (!Object.prototype.hasOwnProperty.call(source ?? {}, key)) return;
  Object.defineProperty(target, key, {
    value: source[key],
    enumerable: false,
    configurable: true,
  });
}
