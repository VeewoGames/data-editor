import { getRows } from "../document-model.mjs";
import { readRowId } from "./row-id.mjs";

export function parseRelationKey(relationKey) {
  const parts = String(relationKey).split(":");
  if (parts.length < 3) return null;
  const [sourceFile, sourceCollection, ...fieldPathParts] = parts;
  const fieldPath = fieldPathParts.join(":").split(".").filter(Boolean);
  if (!sourceFile || !sourceCollection || !fieldPath.length) return null;
  return { sourceFile, sourceCollection, fieldPath };
}

export function findTargetRecord(rows, targetKey, targetId) {
  const needle = String(targetId);
  const rowIndex = rows.findIndex((row) => String(row?.[targetKey] ?? "") === needle);
  return rowIndex >= 0 ? { rowIndex, rowId: readRowId(rows[rowIndex]), row: rows[rowIndex] } : null;
}

export function collectRelationBacklinks({ targetFile, targetCollection, targetKey, targetId, relations, documentsByPath }) {
  const backlinks = [];
  for (const [relationKey, config] of Object.entries(relations ?? {})) {
    if (config.targetFile !== targetFile || config.targetCollection !== targetCollection || config.targetKey !== targetKey) continue;
    const parsed = parseRelationKey(relationKey);
    if (!parsed) continue;
    const sourceDocument = documentsByPath?.[parsed.sourceFile];
    if (!sourceDocument) continue;
    const rows = getRows(sourceDocument, parsed.sourceCollection);
    rows.forEach((row, rowIndex) => {
      const values = getValuesAtPath(row, parsed.fieldPath);
      if (!values.some((value) => relationValueMatches(value, targetId))) return;
      backlinks.push({
        relationKey,
        sourceFile: parsed.sourceFile,
        sourceCollection: parsed.sourceCollection,
        fieldPath: parsed.fieldPath,
        rowIndex,
        rowId: readRowId(row),
        title: getBacklinkTitle(row, rowIndex),
      });
    });
  }
  return backlinks;
}

export function analyzePrimaryKeyChange({ targetFile, targetCollection, targetKey, oldValue, newValue, relations, documentsByPath }) {
  const backlinks = collectRelationBacklinks({
    targetFile,
    targetCollection,
    targetKey,
    targetId: oldValue,
    relations,
    documentsByPath,
  });
  return {
    targetFile,
    targetCollection,
    targetKey,
    oldValue: oldValue == null ? "" : String(oldValue),
    newValue: newValue == null ? "" : String(newValue),
    affectedCount: backlinks.length,
    backlinks,
  };
}

export function buildPrimaryKeySyncPlan({
  targetFile,
  targetCollection,
  targetKey,
  targetRowLabel,
  targetRowIndex,
  oldValue,
  newValue,
  relations,
  documentsByPath,
  targetRows,
}) {
  const normalizedOldValue = oldValue == null ? "" : String(oldValue);
  const normalizedNewValue = newValue == null ? "" : String(newValue);
  const blockingIssues = [];
  const warnings = [];
  const matchedBacklinks = [];
  const rewrites = [];
  const skipped = [];
  const sourceFileSet = new Set();

  if (!normalizedNewValue) blockingIssues.push("empty-primary-key");
  if (normalizedOldValue === normalizedNewValue) blockingIssues.push("unchanged-primary-key");
  if (Array.isArray(targetRows) && targetRows.some((row, rowIndex) => (
    rowIndex !== targetRowIndex
    && String(row?.[targetKey] ?? "") === normalizedNewValue
  ))) {
    blockingIssues.push("duplicate-primary-key");
  }

  const relatedEntries = Object.entries(relations ?? {}).filter(([, config]) => (
    config.targetFile === targetFile
    && config.targetCollection === targetCollection
    && config.targetKey === targetKey
  ));

  for (const [relationKey, config] of relatedEntries) {
    const parsed = parseRelationKey(relationKey);
    if (!parsed) {
      blockingIssues.push("invalid-relation-config");
      continue;
    }
    const sourceDocument = documentsByPath?.[parsed.sourceFile];
    if (!sourceDocument) {
      blockingIssues.push("source-document-load-failed");
      continue;
    }
    sourceFileSet.add(parsed.sourceFile);
    const rows = getRows(sourceDocument, parsed.sourceCollection);
    rows.forEach((row, rowIndex) => {
      const values = getValuesAtPath(row, parsed.fieldPath);
      if (!values.some((value) => relationValueMatches(value, normalizedOldValue))) return;
      const item = {
        relationKey,
        sourceFile: parsed.sourceFile,
        sourceCollection: parsed.sourceCollection,
        fieldPath: parsed.fieldPath,
        rowIndex,
        rowId: readRowId(row),
        rowLabel: getBacklinkTitle(row, rowIndex),
        oldValue: normalizedOldValue,
        newValue: normalizedNewValue,
      };
      matchedBacklinks.push(item);
      if (config.mode !== "single") {
        skipped.push({ ...item, reason: "unsupported-multi" });
        return;
      }
      if (parsed.fieldPath.length !== 1) {
        skipped.push({ ...item, reason: "unsupported-nested-path" });
        return;
      }
      rewrites.push(item);
    });
  }

  if (skipped.length) warnings.push("unsupported-relation-paths-skipped");

  return {
    targetFile,
    targetCollection,
    targetKey,
    targetRowLabel: targetRowLabel ? String(targetRowLabel) : `${targetCollection}:${normalizedOldValue}`,
    oldValue: normalizedOldValue,
    newValue: normalizedNewValue,
    sourceFiles: [...sourceFileSet].sort(),
    matchedBacklinks,
    rewrites,
    skipped,
    blockingIssues: [...new Set(blockingIssues)],
    warnings: [...new Set(warnings)],
  };
}

function getValuesAtPath(value, pathParts) {
  if (!pathParts.length) return [value];
  const [head, ...tail] = pathParts;
  if (head === "*") {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => getValuesAtPath(item, tail));
  }
  if (value == null || typeof value !== "object") return [];
  return getValuesAtPath(value[head], tail);
}

function relationValueMatches(value, targetId) {
  const needle = String(targetId);
  if (Array.isArray(value)) return value.some((item) => relationValueMatches(item, targetId));
  return value != null && String(value) === needle;
}

function getBacklinkTitle(row, rowIndex) {
  if (!row || typeof row !== "object") return `Row ${rowIndex + 1}`;
  const field = Object.keys(row).find((key) => key === "name")
    ?? Object.keys(row).find((key) => key.endsWith("_name"))
    ?? Object.keys(row).find((key) => key === "title")
    ?? Object.keys(row)[0];
  const value = field ? row[field] : null;
  return value != null && value !== "" ? String(value) : `Row ${rowIndex + 1}`;
}
