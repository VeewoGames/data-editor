export function validateRequired(value, fieldName, options = {}) {
  if (!isRequiredField(fieldName, options)) return null;
  if (value == null || value === "") {
    return { severity: "error", message: `${fieldName} 不能为空` };
  }
  return null;
}

export function validateUnique(rows, fieldName, options = {}) {
  if (!isUniqueField(fieldName, options)) return [];
  const counts = new Map();
  for (const row of rows) {
    const value = row?.[fieldName];
    if (value == null || value === "") continue;
    counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  }
  return rows
    .map((row, rowIndex) => {
      const value = row?.[fieldName];
      if (value == null || value === "" || counts.get(String(value)) <= 1) return null;
      return { rowIndex, fieldName, severity: "error", message: `${fieldName} 存在重复值 ${value}` };
    })
    .filter(Boolean);
}

export function buildRelationIndex(rows, keyField) {
  const values = new Set();
  for (const row of rows) {
    const value = row?.[keyField];
    if (value != null && value !== "") values.add(String(value));
  }
  return values;
}

export function validateRelationValue(value, index) {
  if (value == null || value === "") return null;
  if (!index.has(String(value))) {
    return { severity: "warning", message: `未找到引用 ${value}` };
  }
  return null;
}

export function isRequiredField(_fieldName, options = {}) {
  return options.required !== false;
}

export function isUniqueField(_fieldName, options = {}) {
  return options.unique !== false;
}
