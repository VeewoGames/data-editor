export function applyViewSorts(rows, sorts) {
  if (!Array.isArray(sorts) || !sorts.length) return rows;
  return [...rows].sort((left, right) => {
    for (const sort of sorts) {
      const result = compareFieldValue(left?.[sort.field], right?.[sort.field], sort.direction);
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

export function compareFieldValue(left, right, direction = "asc") {
  const leftEmpty = isEmptySortValue(left);
  const rightEmpty = isEmptySortValue(right);
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  const multiplier = direction === "desc" ? -1 : 1;
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
