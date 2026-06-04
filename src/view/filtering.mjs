export function attachRowIndexes(rows) {
  return rows.map((row, index) => {
    const copy = { ...row };
    Object.defineProperty(copy, "__rowIndex", {
      value: typeof row?.__rowIndex === "number" ? row.__rowIndex : index,
      enumerable: false,
      configurable: true,
    });
    return copy;
  });
}

export function applyViewFilters(rows, query, filters) {
  const indexedRows = attachRowIndexes(rows);
  const normalizedQuery = normalizeText(query).toLowerCase();
  const rules = Array.isArray(filters?.rules) ? filters.rules : [];

  return indexedRows.filter((row) => {
    if (normalizedQuery && !rowMatchesQuery(row, normalizedQuery)) return false;
    if (!rules.length) return true;
    return rules.every((rule) => matchesFilterRule(row, rule));
  });
}

export function matchesFilterRule(row, rule) {
  if (!rule || typeof rule !== "object") return true;
  const value = row?.[rule.field];
  switch (rule.operator) {
    case "contains":
      if (!hasExpectedValue(rule.value)) return true;
      return containsValue(value, rule.value);
    case "does_not_contain":
      if (!hasExpectedValue(rule.value)) return true;
      return !containsValue(value, rule.value);
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

function containsValue(value, expected) {
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  if (Array.isArray(value)) {
    return expectedValues.some((item) => value.some((entry) => valuesEqual(entry, item)));
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
