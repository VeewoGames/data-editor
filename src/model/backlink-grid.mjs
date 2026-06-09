import { getRows } from "../document-model.mjs";
import { buildBacklinkFieldName, deriveBacklinkConfigs } from "./field-role.mjs";
import { readRowId } from "./row-id.mjs";

export function getBacklinkColumnsForView({ targetFile, targetCollection, viewConfig }) {
  const derived = deriveBacklinkConfigs(viewConfig);
  return Object.entries(derived)
    .map(([backlinkKey, backlinkConfig]) => {
      const parsed = parseConfigKey(backlinkKey);
      const relationConfig = viewConfig?.relations?.[backlinkConfig.sourceRelation];
      if (!parsed || !relationConfig) return null;
      if (parsed.file !== targetFile || parsed.collection !== targetCollection) return null;
      const sourceFile = String(backlinkConfig.sourceRelation).split(":")[0] ?? "";
      return {
        backlinkKey,
        fieldName: parsed.field,
        sourceRelation: backlinkConfig.sourceRelation,
        targetKey: relationConfig.targetKey,
        status: "active",
        message: sourceFile ? `引用来源：${sourceFile}` : undefined,
      };
    })
    .filter(Boolean);
}

export function buildBacklinkGrid({ targetFile, targetCollection, rows, viewConfig, documentsByPath }) {
  const columns = getBacklinkColumnsForView({ targetFile, targetCollection, viewConfig });
  const valuesByRowIndex = {};

  for (const column of columns) {
    const relationConfig = viewConfig?.relations?.[column.sourceRelation];
    const parsedRelation = parseRelationKey(column.sourceRelation);
    if (!relationConfig || !parsedRelation) continue;
    const sourceDocument = documentsByPath?.[parsedRelation.sourceFile];
    if (!sourceDocument) {
      column.status = "missing-source";
      column.message = `来源文件缺失：${parsedRelation.sourceFile}`;
      rows.forEach((_, rowIndex) => {
        valuesByRowIndex[rowIndex] ??= {};
        valuesByRowIndex[rowIndex][column.fieldName] = [];
      });
      continue;
    }
    const sourceRows = getRows(sourceDocument, parsedRelation.sourceCollection);
    const grouped = new Map();

    sourceRows.forEach((row, rowIndex) => {
      const values = getValuesAtPath(row, parsedRelation.fieldPath)
        .flatMap((value) => Array.isArray(value) ? value : [value])
        .filter((value) => value != null && value !== "");
      const title = getBacklinkTitle(row, rowIndex);
      for (const value of values) {
        const key = String(value);
        const current = grouped.get(key) ?? [];
        current.push({
          relationKey: column.sourceRelation,
          sourceFile: parsedRelation.sourceFile,
          sourceCollection: parsedRelation.sourceCollection,
          fieldPath: parsedRelation.fieldPath,
          rowIndex,
          rowId: readRowId(row),
          title,
          value: key,
        });
        grouped.set(key, current);
      }
    });

    rows.forEach((row, rowIndex) => {
      const targetValue = row?.[relationConfig.targetKey];
      const items = targetValue == null || targetValue === "" ? [] : (grouped.get(String(targetValue)) ?? []);
      valuesByRowIndex[rowIndex] ??= {};
      valuesByRowIndex[rowIndex][column.fieldName] = items;
    });
  }

  return { columns, valuesByRowIndex };
}

function parseConfigKey(value) {
  const parts = String(value).split(":");
  if (parts.length < 3) return null;
  const [file, collection, ...fieldParts] = parts;
  const field = fieldParts.join(":");
  if (!file || !collection || !field) return null;
  return { file, collection, field };
}

function parseRelationKey(relationKey) {
  const parts = String(relationKey).split(":");
  if (parts.length < 3) return null;
  const [sourceFile, sourceCollection, ...fieldPathParts] = parts;
  const fieldPath = fieldPathParts.join(":").split(".").filter(Boolean);
  if (!sourceFile || !sourceCollection || !fieldPath.length) return null;
  return { sourceFile, sourceCollection, fieldPath };
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

function getBacklinkTitle(row, rowIndex) {
  if (!row || typeof row !== "object") return `Row ${rowIndex + 1}`;
  const field = Object.keys(row).find((key) => key === "name")
    ?? Object.keys(row).find((key) => key.endsWith("_name"))
    ?? Object.keys(row).find((key) => key === "title")
    ?? Object.keys(row)[0];
  const value = field ? row[field] : null;
  return value != null && value !== "" ? String(value) : `Row ${rowIndex + 1}`;
}
