/** Read-only presentation uses the same selected-row and marker semantics as save protection. */
export function fieldWritePolicyMatchesRow(policy, row) {
  if (!row) return false;
  if (policy.rowSelector) return policy.rowSelector.values.includes(row[policy.rowSelector.primaryKeyField]);
  return policy.requiresFields.every(field => Object.hasOwn(row, field));
}

export function canEditNestedField(permission, row, rootField) {
  return permission?.row === row && permission.ready === true && !permission.protectedFields.has(rootField);
}
