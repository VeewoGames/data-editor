export function resolveValidationIssue(validation, rowId, rowIndex, fieldName) {
  return (rowId ? validation.byRowId[rowId]?.[fieldName] ?? null : null)
    ?? (rowIndex == null ? null : validation.byRowIndex[String(rowIndex)]?.[fieldName] ?? null);
}
