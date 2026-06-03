export function validateRequired(value, fieldName) {
  if (!isRequiredField(fieldName)) return null;
  if (value == null || value === "") {
    return { severity: "error", message: `${fieldName} 不能为空` };
  }
  return null;
}

export function validateUnique(rows, fieldName) {
  if (!isUniqueField(fieldName)) return [];
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

export function isRequiredField(fieldName) {
  return ["id", "name", "skill_id", "rune_id", "keyword_id"].includes(fieldName) || fieldName.endsWith("_id");
}

export function isUniqueField(fieldName) {
  return fieldName === "id" || fieldName.endsWith("_id");
}
