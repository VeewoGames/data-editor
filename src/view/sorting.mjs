export function applyViewSorts(rows, sorts, fieldTypes = {}, optionOrdersByField = {}) {
  if (!Array.isArray(sorts) || !sorts.length) return rows;
  return [...rows].sort((left, right) => {
    for (const sort of sorts) {
      const result = compareFieldValue(
        left?.[sort.field],
        right?.[sort.field],
        sort.direction,
        fieldTypes?.[sort.field],
        optionOrdersByField?.[sort.field],
      );
      if (result !== 0) return result;
    }
    return 0;
  });
}

export function updateHeaderSorts(sorts, field, direction) {
  const existingSorts = Array.isArray(sorts) ? sorts : [];
  const withoutField = existingSorts.filter((sort) => sort?.field !== field);
  if (!direction) return withoutField;
  const existingSort = existingSorts.find((sort) => sort?.field === field);
  const nextSort = {
    id: existingSort?.id ?? `sort:${field}`,
    field,
    direction,
  };
  return existingSort
    ? existingSorts.map((sort) => sort?.field === field ? nextSort : sort)
    : [...existingSorts, nextSort];
}

export function compareFieldValue(left, right, direction = "asc", fieldType, optionOrder = []) {
  const leftEmpty = isEmptySortValue(left);
  const rightEmpty = isEmptySortValue(right);
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  const multiplier = direction === "desc" ? -1 : 1;
  if (usesOptionOrder(fieldType) && Array.isArray(optionOrder) && optionOrder.length) {
    const optionOrderResult = compareByOptionOrder(left, right, optionOrder);
    if (optionOrderResult !== 0) return optionOrderResult * multiplier;
  }
  if (typeof left === "number" && typeof right === "number") {
    return compareNumbers(left, right) * multiplier;
  }
  return String(left).localeCompare(String(right), undefined, { numeric: true }) * multiplier;
}

function compareNumbers(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isEmptySortValue(value) {
  return value == null || value === "";
}

function usesOptionOrder(fieldType) {
  return fieldType === "Select" || fieldType === "Multi-select" || fieldType === "Relation";
}

function compareByOptionOrder(left, right, optionOrder) {
  const orderIndex = new Map(optionOrder.map((value, index) => [String(value), index]));
  const leftValues = normalizeOrderedValues(left, orderIndex);
  const rightValues = normalizeOrderedValues(right, orderIndex);
  const sharedLength = Math.min(leftValues.length, rightValues.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftRank = resolveOptionRank(leftValues[index], orderIndex);
    const rightRank = resolveOptionRank(rightValues[index], orderIndex);
    if (leftRank !== rightRank) return leftRank - rightRank;
    const lexical = String(leftValues[index]).localeCompare(String(rightValues[index]), undefined, { numeric: true });
    if (lexical !== 0) return lexical;
  }
  if (leftValues.length !== rightValues.length) return leftValues.length - rightValues.length;
  return 0;
}

function normalizeOrderedValues(value, orderIndex) {
  if (Array.isArray(value)) {
    return [...value].sort((left, right) => {
      const leftRank = resolveOptionRank(left, orderIndex);
      const rightRank = resolveOptionRank(right, orderIndex);
      if (leftRank !== rightRank) return leftRank - rightRank;
      return String(left).localeCompare(String(right), undefined, { numeric: true });
    });
  }
  return [value];
}

function resolveOptionRank(value, orderIndex) {
  const rank = orderIndex.get(String(value));
  return rank == null ? Number.MAX_SAFE_INTEGER : rank;
}
