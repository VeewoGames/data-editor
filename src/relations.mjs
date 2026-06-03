export function buildRelationOptions(rows, keyField, titleFields = ["name", "*_name"]) {
  const options = [];
  const seen = new Set();
  for (const row of rows) {
    const value = row?.[keyField];
    if (value == null || value === "") continue;
    const optionValue = String(value);
    if (seen.has(optionValue)) continue;
    seen.add(optionValue);
    const label = getRelationRecordLabel(row, keyField, optionValue, titleFields);
    options.push({
      value: optionValue,
      label,
      description: label === optionValue ? "" : optionValue,
    });
  }
  return options;
}

export function getRelationOptionLabel(value, options) {
  if (value == null || value === "") return "";
  const option = options.find((candidate) => String(candidate.value) === String(value));
  return option?.label ?? String(value);
}

function getRelationRecordLabel(row, keyField, fallback, titleFields) {
  if (!row || typeof row !== "object") return fallback;
  for (const fieldName of titleFields) {
    if (fieldName === "*_name") {
      const nameSuffix = Object.entries(row).find(([key, value]) => key.endsWith("_name") && typeof value === "string" && value);
      if (nameSuffix) return nameSuffix[1];
      continue;
    }
    if (typeof row[fieldName] === "string" && row[fieldName]) return row[fieldName];
  }
  return fallback;
}
