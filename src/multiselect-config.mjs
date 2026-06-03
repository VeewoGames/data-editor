export function renameMultiSelectOptionInRows(rows, fieldName, previousValue, nextValue) {
  const from = String(previousValue);
  const to = String(nextValue);
  for (const row of rows) {
    const value = row?.[fieldName];
    if (!Array.isArray(value)) continue;
    row[fieldName] = value.map((item) => String(item) === from ? castLike(item, to) : item);
  }
}

export function renameSingleSelectOptionInRows(rows, fieldName, previousValue, nextValue) {
  const from = String(previousValue);
  const to = String(nextValue);
  for (const row of rows) {
    const value = row?.[fieldName];
    if (value == null || Array.isArray(value) || typeof value === "object") continue;
    if (String(value) === from) row[fieldName] = castLike(value, to);
  }
}

export function removeMultiSelectOptionFromRows(rows, fieldName, optionValue) {
  const target = String(optionValue);
  for (const row of rows) {
    const value = row?.[fieldName];
    if (!Array.isArray(value)) continue;
    row[fieldName] = value.filter((item) => String(item) !== target);
  }
}

export function removeSingleSelectOptionFromRows(rows, fieldName, optionValue) {
  const target = String(optionValue);
  for (const row of rows) {
    const value = row?.[fieldName];
    if (value == null || Array.isArray(value) || typeof value === "object") continue;
    if (String(value) === target) row[fieldName] = "";
  }
}

export function buildMultiSelectFieldConfig(discoveredOptions, storedFieldConfig) {
  const storedOptions = storedFieldConfig?.multiSelectOptions ?? {};
  const orderedValues = [...new Set([
    ...Object.keys(storedOptions),
    ...discoveredOptions.map((value) => String(value)),
  ])].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const options = orderedValues.map((value) => ({
    value,
    label: storedOptions[value]?.label ?? value,
    color: storedOptions[value]?.color ?? null,
  }));
  return {
    options,
    optionMap: Object.fromEntries(options.map((option) => [option.value, option])),
  };
}

function castLike(previousValue, nextValue) {
  if (typeof previousValue === "number" && /^-?\d+(\.\d+)?$/.test(nextValue)) return Number(nextValue);
  return nextValue;
}
