import { buildCollectionKey } from "../model/primary-key-candidate.mjs";
import { buildRelationKey } from "../model/relation-path.mjs";
import { validateRelationValue, validateRequired, validateUnique } from "../validation.mjs";

export function buildValidationIssueMap({
  rows,
  collectionStore,
  fieldConfig,
  relationIndexes,
  validationConfig,
  sourcePath,
  collectionPath,
}) {
  const result = {};
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  for (const field of fields) {
    Object.assign(result, buildFieldIssueLookup({
      rows,
      collectionStore,
      fieldConfig,
      relationIndexes,
      validationConfig,
      sourcePath,
      collectionPath,
      fieldName: field,
    }));
  }
  return result;
}

export function buildValidationSnapshot(input) {
  return createValidationSnapshot(buildValidationIssueMap(input));
}

export function patchValidationSnapshotForRowField({
  previousSnapshot,
  invalidation,
  rows,
  collectionStore,
  fieldConfig,
  relationIndexes,
  validationConfig,
  sourcePath,
  collectionPath,
}) {
  if (!previousSnapshot || invalidation.type !== "row-field") return null;
  const resolvedRowIndex = invalidation.rowIndex ?? (
    invalidation.rowId == null ? null : (collectionStore?.sourceIndexByRowId.get(invalidation.rowId) ?? null)
  );
  if (resolvedRowIndex == null) return null;
  const nextIssueLookup = buildFieldIssueLookup({
    rows,
    collectionStore,
    fieldConfig,
    relationIndexes,
    validationConfig,
    sourcePath,
    collectionPath,
    fieldName: invalidation.fieldName,
    rowIndexes: [resolvedRowIndex],
  });
  const nextSnapshot = {
    byRowId: { ...previousSnapshot.byRowId },
    byRowIndex: { ...previousSnapshot.byRowIndex },
    collectionIssues: previousSnapshot.collectionIssues,
  };
  const rowId = invalidation.rowId ?? (collectionStore?.rowViews?.[resolvedRowIndex]?.rowId ?? null);
  if (rowId) {
    const nextRowIssues = { ...(nextSnapshot.byRowId[rowId] ?? {}) };
    delete nextRowIssues[invalidation.fieldName];
    const nextIssue = nextIssueLookup[`${rowId}:${invalidation.fieldName}`] ?? null;
    if (nextIssue) {
      nextRowIssues[invalidation.fieldName] = nextIssue;
    }
    if (Object.keys(nextRowIssues).length) {
      nextSnapshot.byRowId[rowId] = nextRowIssues;
    } else {
      delete nextSnapshot.byRowId[rowId];
    }
    return nextSnapshot;
  }
  const rowIndexKey = String(resolvedRowIndex);
  const nextRowIssues = { ...(nextSnapshot.byRowIndex[rowIndexKey] ?? {}) };
  delete nextRowIssues[invalidation.fieldName];
  const nextIssue = nextIssueLookup[`${rowIndexKey}:${invalidation.fieldName}`] ?? null;
  if (nextIssue) {
    nextRowIssues[invalidation.fieldName] = nextIssue;
  }
  if (Object.keys(nextRowIssues).length) {
    nextSnapshot.byRowIndex[rowIndexKey] = nextRowIssues;
  } else {
    delete nextSnapshot.byRowIndex[rowIndexKey];
  }
  return nextSnapshot;
}

export function patchValidationSnapshotForField({
  previousSnapshot,
  invalidation,
  rows,
  collectionStore,
  fieldConfig,
  relationIndexes,
  validationConfig,
  sourcePath,
  collectionPath,
}) {
  if (!previousSnapshot || invalidation.type !== "field") return null;
  const nextIssueLookup = buildFieldIssueLookup({
    rows,
    collectionStore,
    fieldConfig,
    relationIndexes,
    validationConfig,
    sourcePath,
    collectionPath,
    fieldName: invalidation.fieldName,
  });
  return mergeFieldIssueLookupIntoSnapshot(previousSnapshot, invalidation.fieldName, nextIssueLookup);
}

export function buildIssueKey(collectionStore, rowIndex, fieldName) {
  const rowId = collectionStore?.rowViews?.[rowIndex]?.rowId ?? null;
  return rowId ? `${rowId}:${fieldName}` : `${rowIndex}:${fieldName}`;
}

function createValidationSnapshot(issueLookup) {
  const byRowId = {};
  const byRowIndex = {};
  for (const [issueKey, issue] of Object.entries(issueLookup)) {
    const separatorIndex = issueKey.lastIndexOf(":");
    if (separatorIndex <= 0) continue;
    const rowKey = issueKey.slice(0, separatorIndex);
    const fieldName = issueKey.slice(separatorIndex + 1);
    if (/^\d+$/.test(rowKey)) {
      (byRowIndex[rowKey] ??= {})[fieldName] = issue;
      continue;
    }
    (byRowId[rowKey] ??= {})[fieldName] = issue;
  }
  return {
    byRowId,
    byRowIndex,
    collectionIssues: {},
  };
}

function mergeFieldIssueLookupIntoSnapshot(previousSnapshot, fieldName, nextIssueLookup) {
  const nextSnapshot = {
    byRowId: {},
    byRowIndex: {},
    collectionIssues: previousSnapshot.collectionIssues,
  };
  for (const [rowId, fieldIssues] of Object.entries(previousSnapshot.byRowId)) {
    const nextFieldIssues = { ...fieldIssues };
    delete nextFieldIssues[fieldName];
    if (Object.keys(nextFieldIssues).length) {
      nextSnapshot.byRowId[rowId] = nextFieldIssues;
    }
  }
  for (const [rowIndexKey, fieldIssues] of Object.entries(previousSnapshot.byRowIndex)) {
    const nextFieldIssues = { ...fieldIssues };
    delete nextFieldIssues[fieldName];
    if (Object.keys(nextFieldIssues).length) {
      nextSnapshot.byRowIndex[rowIndexKey] = nextFieldIssues;
    }
  }
  for (const [issueKey, issue] of Object.entries(nextIssueLookup)) {
    const separatorIndex = issueKey.lastIndexOf(":");
    if (separatorIndex <= 0 || !issue) continue;
    const rowKey = issueKey.slice(0, separatorIndex);
    const nextFieldName = issueKey.slice(separatorIndex + 1);
    if (/^\d+$/.test(rowKey)) {
      (nextSnapshot.byRowIndex[rowKey] ??= {})[nextFieldName] = issue;
      continue;
    }
    (nextSnapshot.byRowId[rowKey] ??= {})[nextFieldName] = issue;
  }
  return nextSnapshot;
}

function buildFieldIssueLookup({
  rows,
  collectionStore,
  fieldConfig,
  relationIndexes,
  validationConfig,
  sourcePath,
  collectionPath,
  fieldName,
  rowIndexes = null,
}) {
  const result = {};
  const primaryKey = validationConfig.primaryKeys[buildCollectionKey(sourcePath, collectionPath)] ?? null;
  const isPrimaryKey = fieldName === primaryKey;
  const duplicateIssues = new Map(
    validateUnique(rows, fieldName, { unique: isPrimaryKey })
      .filter((issue) => issue.rowIndex != null)
      .map((issue) => [issue.rowIndex, issue]),
  );
  const targetRowIndexes = rowIndexes ?? rows.map((_, index) => index);
  for (const rowIndex of targetRowIndexes) {
    const row = rows[rowIndex];
    if (!row) continue;
    const issueKey = buildIssueKey(collectionStore, rowIndex, fieldName);
    const nextIssue = buildFieldIssue({
      row,
      rowIndex,
      fieldName,
      isPrimaryKey,
      duplicateIssue: duplicateIssues.get(rowIndex) ?? null,
      fieldConfig,
      relationIndexes,
      relationConfigs: validationConfig.relations,
      sourcePath,
      collectionPath,
    });
    if (nextIssue) result[issueKey] = nextIssue;
  }
  return result;
}

function buildFieldIssue({
  row,
  fieldName,
  isPrimaryKey,
  duplicateIssue,
  fieldConfig,
  relationIndexes,
  relationConfigs,
  sourcePath,
  collectionPath,
}) {
  let issue = duplicateIssue;
  const required = validateRequired(row[fieldName], fieldName, { required: isPrimaryKey });
  if (required) issue = required;
  const displayType = fieldConfig.displayTypes[fieldName];
  if (displayType && !fieldConfig.isCompatible(displayType, row[fieldName])) {
    issue = { severity: "error", message: `当前值不能用 ${displayType} 显示` };
  }
  const relationIssue = validateRelationAtPath({
    pathParts: [fieldName],
    value: row[fieldName],
    relationIndexes,
    relationConfigs,
    sourcePath,
    collectionPath,
  });
  if (relationIssue && !issue) issue = relationIssue;
  for (const nestedIssue of collectNestedRelationIssues({
    value: row[fieldName],
    path: [fieldName],
    relationIndexes,
    relationConfigs,
    sourcePath,
    collectionPath,
  })) {
    if (!issue) issue = nestedIssue;
  }
  return issue;
}

function collectNestedRelationIssues({
  value,
  path,
  relationIndexes,
  relationConfigs,
  sourcePath,
  collectionPath,
}) {
  const issues = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      issues.push(...collectNestedRelationIssues({
        value: item,
        path: [...path, index],
        relationIndexes,
        relationConfigs,
        sourcePath,
        collectionPath,
      }));
    });
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const nestedPath = [...path, key];
      const issue = validateRelationAtPath({
        pathParts: nestedPath,
        value: nested,
        relationIndexes,
        relationConfigs,
        sourcePath,
        collectionPath,
      });
      if (issue) issues.push(issue);
      issues.push(...collectNestedRelationIssues({
        value: nested,
        path: nestedPath,
        relationIndexes,
        relationConfigs,
        sourcePath,
        collectionPath,
      }));
    }
  }
  return issues;
}

function validateRelationAtPath({
  pathParts,
  value,
  relationIndexes,
  relationConfigs,
  sourcePath,
  collectionPath,
}) {
  const relationKey = buildRelationKey({ sourceFile: sourcePath, sourceCollection: collectionPath, fieldPath: pathParts });
  const config = relationConfigs[relationKey];
  if (!config) return null;
  const index = relationIndexes[relationKey];
  if (index == null) return { severity: "neutral", message: `${config.targetKey} 未检查` };
  if (config.mode === "multi") {
    if (!Array.isArray(value)) return { severity: "error", message: `当前值不能用 ${config.targetKey} 多值关联显示` };
    const missing = value
      .filter((item) => item == null || typeof item !== "object")
      .map((item) => validateRelationValue(item, index))
      .filter(Boolean)
      .map((issue) => issue.message.replace("未找到引用 ", ""));
    return missing.length ? { severity: "warning", message: `未找到引用 ${missing.join(", ")}` } : null;
  }
  if (Array.isArray(value)) return { severity: "error", message: `当前值不能用 ${config.targetKey} 单值关联显示` };
  if (value && typeof value === "object") return null;
  return validateRelationValue(value, index);
}
