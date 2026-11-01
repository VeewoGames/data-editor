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
    if (String(value) === target) row[fieldName] = null;
  }
}

export function buildMultiSelectFieldConfig(discoveredOptions, storedFieldConfig) {
  const storedOptions = storedFieldConfig?.multiSelectOptions ?? {};
  const dataValues = new Map();
  const ambiguous = new Set();
  for (const value of discoveredOptions) {
    const key = String(value);
    if (dataValues.has(key) && dataValues.get(key) !== value) ambiguous.add(key);
    else dataValues.set(key, value);
  }
  const orderedValues = [...new Set([
    ...Object.keys(storedOptions),
    ...discoveredOptions.map((value) => String(value)),
  ])];
  const options = orderedValues.map((value) => {
    const stored = normalizeOptionDataValue(value, storedOptions[value]?.dataValue);
    const observed = dataValues.has(value) ? dataValues.get(value) : stored.dataValue;
    const typed = typeof observed === "number" || stored.dataValue !== undefined ? { dataValue: observed } : {};
    return {
      value,
      ...(ambiguous.has(value) ? { dataValueAmbiguous: true } : typed),
      ...(typed.dataValue !== undefined && typed.dataValue !== stored.dataValue ? { dataValueNeedsPersistence: true } : {}),
      label: storedOptions[value]?.label ?? value,
      color: storedOptions[value]?.color ?? null,
    };
  });
  return {
    options,
    optionMap: Object.fromEntries(options.map((option) => [option.value, option])),
  };
}

// UI keys are strings, but a key must never decide the type written to JSON.
export function resolveOptionDataValue(value, options) {
  const option = options.find(option => option.value === String(value));
  if (option?.dataValueAmbiguous) return undefined;
  return option?.dataValue ?? value;
}

export function normalizeOptionDataValue(key, value) {
  return ((typeof value === "number" && Number.isFinite(value)) || typeof value === "string") && String(value) === key
    ? { dataValue: value } : {};
}

export function buildSchemaOptionViews(options = []) {
  const config = buildMultiSelectFieldConfig(options.map(option => option.value));
  return config.options.map(option => ({
    ...option,
    label: options.find(source => String(source.value) === option.value)?.label ?? option.label,
    dataValueNeedsPersistence: false, // The schema remains the explicit source, including when every cell is empty.
  }));
}

export function buildSingleSelectFieldConfigFromRows(rows, fieldName, storedFieldConfig) {
  const values = rows.map(row => row[fieldName]).filter(value => typeof value === "string" || typeof value === "number");
  return buildMultiSelectFieldConfig(values, { multiSelectOptions: storedFieldConfig?.selectOptions });
}

export function buildMultiSelectFieldConfigFromRows(rows, fieldName, storedFieldConfig) {
  const values = [];
  for (const row of rows) {
    const value = row?.[fieldName];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item == null || (typeof item !== "string" && typeof item !== "number")) continue;
      values.push(item);
    }
  }
  return buildMultiSelectFieldConfig(values, storedFieldConfig);
}

export function sortValuesByOptionOrder(values, orderedOptionValues) {
  const orderIndex = new Map(orderedOptionValues.map((value, index) => [String(value), index]));
  return [...values].sort((left, right) => {
    const leftKey = String(left);
    const rightKey = String(right);
    const leftIndex = orderIndex.get(leftKey);
    const rightIndex = orderIndex.get(rightKey);
    if (leftIndex == null && rightIndex == null) return 0;
    if (leftIndex == null) return 1;
    if (rightIndex == null) return -1;
    return leftIndex - rightIndex;
  });
}

export function buildOptionConfigByOrder(optionConfig, orderedValues) {
  const nextConfig = {};
  const seen = new Set();
  for (const value of orderedValues) {
    const key = String(value);
    if (seen.has(key)) continue;
    const config = optionConfig[key];
    nextConfig[key] = config ?? { label: key, color: null };
    seen.add(key);
  }
  for (const [key, config] of Object.entries(optionConfig)) {
    if (seen.has(key)) continue;
    nextConfig[key] = config;
  }
  return nextConfig;
}

export function buildOptionConfigFromOptions(options) {
  const nextConfig = {};
  for (const option of options) {
    const key = String(option.value);
    nextConfig[key] = {
      label: option.label ?? key,
      color: option.color ?? null,
      ...(option.dataValueAmbiguous ? {} : normalizeOptionDataValue(key, option.dataValue)),
    };
  }
  return nextConfig;
}

export function renameOptionConfigValue(optionConfig, previousValue, nextValue, fallbackColor = null) {
  const nextConfig = {};
  const fromKey = String(previousValue);
  const toKey = String(nextValue);
  for (const [key, config] of Object.entries(optionConfig)) {
    if (key === fromKey) {
      nextConfig[toKey] = {
        label: toKey,
        color: config?.color ?? fallbackColor,
      };
      continue;
    }
    nextConfig[key] = config;
  }
  if (!nextConfig[toKey]) {
    nextConfig[toKey] = { label: toKey, color: fallbackColor };
  }
  return nextConfig;
}

function castLike(previousValue, nextValue) {
  if (typeof previousValue === "number" && /^-?\d+(\.\d+)?$/.test(nextValue)) return Number(nextValue);
  return nextValue;
}
