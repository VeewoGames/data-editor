const discreteContainsFieldTypes = new Set(["Select", "Multi-select", "Relation"]);

export function deriveNewRowSeedValues(filters, fieldTypes = {}) {
  const nextRow = {};
  const conflicts = new Set();
  for (const rule of filters?.topLevelRules ?? []) {
    const fieldType = fieldTypes?.[rule.field];
    const seeded = deriveRuleSeed(rule, fieldType);
    if (!seeded) continue;
    mergeSeedEntry(nextRow, conflicts, seeded.field, seeded.value, fieldType);
  }
  const advancedSeed = deriveNodeSeed(filters?.advancedRoot ?? null, fieldTypes);
  if (advancedSeed) {
    for (const [field, value] of Object.entries(advancedSeed)) {
      mergeSeedEntry(nextRow, conflicts, field, value, fieldTypes?.[field]);
    }
  }
  return nextRow;
}

function deriveRuleSeed(rule, fieldType) {
  if (!rule || typeof rule !== "object" || rule.kind !== "rule" || typeof rule.field !== "string") return null;
  if (rule.operator === "is") {
    const normalized = normalizeSeedValue(rule.value, fieldType);
    return normalized == null ? null : { field: rule.field, value: normalized };
  }
  if (rule.operator === "contains" && discreteContainsFieldTypes.has(fieldType)) {
    const normalized = normalizeContainsSeedValue(rule.value, fieldType);
    return normalized == null ? null : { field: rule.field, value: normalized };
  }
  return null;
}

function normalizeContainsSeedValue(value, fieldType) {
  if (fieldType === "Multi-select") {
    const normalized = normalizeStringArray(value);
    return normalized.length > 0 ? normalized : null;
  }
  if (Array.isArray(value)) return value.length === 1 ? normalizeScalarSeed(value[0], fieldType) : null;
  return normalizeScalarSeed(value, fieldType);
}

function normalizeSeedValue(value, fieldType) {
  if (fieldType === "Multi-select") {
    if (Array.isArray(value)) {
      const normalized = normalizeStringArray(value);
      return normalized.length > 0 ? normalized : null;
    }
    const scalar = normalizeScalarSeed(value, "Select");
    return scalar == null ? null : [scalar];
  }
  return normalizeScalarSeed(value, fieldType);
}

function normalizeScalarSeed(value, fieldType) {
  if (value == null || value === "") return null;
  if (fieldType === "Checkbox") return normalizeBoolean(value);
  return value;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return Boolean(value);
}

function normalizeStringArray(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.filter((item) => item != null && item !== "").map((item) => String(item)))];
}

function sameSeedValue(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => right[index] === value);
  }
  return left === right;
}

const conflictMarker = Symbol("conflict");

function mergeSeedValue(currentValue, nextValue, fieldType) {
  if (fieldType === "Multi-select" && Array.isArray(currentValue) && Array.isArray(nextValue)) {
    return [...new Set([...currentValue, ...nextValue])];
  }
  return sameSeedValue(currentValue, nextValue) ? currentValue : conflictMarker;
}

function mergeSeedEntry(target, conflicts, field, value, fieldType) {
  if (Object.hasOwn(target, field)) {
    const merged = mergeSeedValue(target[field], value, fieldType);
    if (merged !== conflictMarker) {
      target[field] = merged;
      return;
    }
    delete target[field];
    conflicts.add(field);
    return;
  }
  if (!conflicts.has(field)) target[field] = value;
}

function deriveNodeSeed(node, fieldTypes = {}) {
  if (!node || typeof node !== "object") return null;
  if (node.kind === "rule") {
    const seeded = deriveRuleSeed(node, fieldTypes?.[node.field]);
    return seeded ? { [seeded.field]: seeded.value } : null;
  }
  if (node.kind !== "group") return null;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) return null;
  if (node.op === "or") {
    for (const child of children) {
      const seeded = deriveNodeSeed(child, fieldTypes);
      if (seeded && Object.keys(seeded).length > 0) return seeded;
    }
    return null;
  }
  const result = {};
  const conflicts = new Set();
  for (const child of children) {
    const seeded = deriveNodeSeed(child, fieldTypes);
    if (!seeded) return null;
    for (const [field, value] of Object.entries(seeded)) {
      mergeSeedEntry(result, conflicts, field, value, fieldTypes?.[field]);
      if (conflicts.has(field)) return null;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}
