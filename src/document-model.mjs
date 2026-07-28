import { setByPath } from "./path-utils.mjs";
import {
  buildVisibleFieldList,
  ensurePersistentEntryId,
  persistentEntryIdField,
} from "./model/persistent-entry-id.mjs";
import { resolveAutoSuffixedPrimaryKeyValue } from "./model/primary-key-auto-suffix.mjs";

const objectMapCollectionPath = "$";
const defaultObjectMapKeyField = "key";
const fallbackObjectMapKeyField = "__key";

export function buildDocumentModel(root, format, sourcePath = "") {
  const objectMap = detectObjectMapRoot(root);
  return {
    format,
    sourcePath,
    root,
    rootKind: Array.isArray(root) ? "array" : "object",
    collections: findCollections(root, objectMap),
    metadata: findMetadata(root, objectMap),
    rootCollectionKind: objectMap ? "record-map" : undefined,
    rootKeyField: objectMap?.keyField,
  };
}

export function getRows(model, collectionPath) {
  if (collectionPath === "$") {
    if (Array.isArray(model.root)) return model.root;
    if (isRecordMapModel(model)) return getRecordMapRows(model.root, model.rootKeyField);
    return [];
  }
  const rows = isPlainObject(model.root) ? model.root[collectionPath] : [];
  return Array.isArray(rows) ? rows : [];
}

export function getMainColumns(model, collectionPath) {
  if (isRecordMapModel(model) && collectionPath === objectMapCollectionPath) {
    const fields = classifyFields(getRows(model, collectionPath), model.rootKeyField);
    return [model.rootKeyField, ...buildVisibleFieldList(fields.main)];
  }
  return buildVisibleFieldList(classifyFields(getRows(model, collectionPath)).main);
}

export function getNestedFields(model, collectionPath) {
  return buildVisibleFieldList(classifyFields(
    getRows(model, collectionPath),
    isRecordMapModel(model) && collectionPath === objectMapCollectionPath ? model.rootKeyField : null,
  ).nested);
}

export function summarizeNested(value) {
  if (Array.isArray(value)) {
    if (value.every((item) => item == null || typeof item !== "object")) return `Array(${value.length})`;
    if (value.every((item) => isPlainObject(item))) return `Object Array(${value.length})`;
    return `Mixed Array(${value.length})`;
  }
  if (isPlainObject(value)) return `Object(${Object.keys(value).length})`;
  return "";
}

export function setCellValue(model, collectionPath, rowIndex, fieldName, value) {
  if (isRecordMapModel(model) && collectionPath === objectMapCollectionPath) {
    const [currentKey, row] = getRecordMapEntryAt(model.root, rowIndex);
    if (!isPlainObject(row)) throw new Error("Selected row is not editable");
    if (fieldName === model.rootKeyField) {
      renameRecordMapKey(model.root, currentKey, value);
      return;
    }
    row[fieldName] = value;
    return;
  }
  const row = getRows(model, collectionPath)[rowIndex];
  if (!isPlainObject(row)) throw new Error("Selected row is not editable");
  row[fieldName] = value;
}

export function setNestedValue(model, collectionPath, rowIndex, pathParts, value) {
  if (isRecordMapModel(model) && collectionPath === objectMapCollectionPath) {
    const [, row] = getRecordMapEntryAt(model.root, rowIndex);
    if (!isPlainObject(row)) throw new Error("Selected row is not editable");
    setByPath(row, pathParts, value);
    return;
  }
  const row = getRows(model, collectionPath)[rowIndex];
  if (!isPlainObject(row)) throw new Error("Selected row is not editable");
  setByPath(row, pathParts, value);
}

export function addRow(model, collectionPath, row) {
  if (isRecordMapModel(model) && collectionPath === objectMapCollectionPath) {
    const key = createRecordMapKey(model.root);
    model.root[key] = stripRecordMapKey(row, model.rootKeyField);
    return;
  }
  ensurePersistentEntryId(row);
  getRows(model, collectionPath).push(row);
}

export function deleteRow(model, collectionPath, rowIndex) {
  if (isRecordMapModel(model) && collectionPath === objectMapCollectionPath) {
    const [key] = getRecordMapEntryAt(model.root, rowIndex);
    delete model.root[key];
    return;
  }
  getRows(model, collectionPath).splice(rowIndex, 1);
}

export function reorderRows(model, collectionPath, sourceIndex, targetIndex, placement) {
  const rows = getMutableArrayCollection(model, collectionPath);
  assertValidRowIndex(rows, sourceIndex, "source");
  assertValidRowIndex(rows, targetIndex, "target");
  if (sourceIndex === targetIndex) throw new Error("Source and target rows must be different");
  if (placement !== "before" && placement !== "after") {
    throw new Error(`Invalid row placement: ${placement}`);
  }

  const [movedRow] = rows.splice(sourceIndex, 1);
  let nextIndex = targetIndex;
  if (sourceIndex < targetIndex) nextIndex -= 1;
  if (placement === "after") nextIndex += 1;
  rows.splice(nextIndex, 0, movedRow);
  return { sourceIndex: nextIndex, sourceKey: null };
}

export function duplicateRow(model, collectionPath, sourceLocator, primaryKeyField = null) {
  if (!sourceLocator || typeof sourceLocator !== "object") {
    throw new Error("Source row locator is required");
  }

  if (isRecordMapModel(model) && collectionPath === objectMapCollectionPath) {
    const sourceKey = String(sourceLocator.sourceKey ?? "");
    if (!sourceKey || !Object.hasOwn(model.root, sourceKey)) {
      throw new Error("Selected record-map row does not exist");
    }
    const rows = getRows(model, collectionPath);
    const duplicate = cloneRow(model.root[sourceKey]);
    delete duplicate[persistentEntryIdField];
    applyDuplicatePrimaryKey(duplicate, rows, primaryKeyField, model.rootKeyField);
    const nextKey = createRecordMapKey(model.root);
    model.root[nextKey] = stripRecordMapKey(duplicate, model.rootKeyField);
    return {
      sourceIndex: Object.keys(model.root).length - 1,
      sourceKey: nextKey,
    };
  }

  const rows = getMutableArrayCollection(model, collectionPath);
  assertValidRowIndex(rows, sourceLocator.sourceIndex, "source");
  const duplicate = cloneRow(rows[sourceLocator.sourceIndex]);
  delete duplicate[persistentEntryIdField];
  applyDuplicatePrimaryKey(duplicate, rows, primaryKeyField);
  ensurePersistentEntryId(duplicate);
  const nextIndex = sourceLocator.sourceIndex + 1;
  rows.splice(nextIndex, 0, duplicate);
  return { sourceIndex: nextIndex, sourceKey: null };
}

export function addField(model, collectionPath, rowIndex, fieldName, value, applyToAll = false) {
  if (isRecordMapModel(model) && collectionPath === objectMapCollectionPath && fieldName === model.rootKeyField) {
    throw new Error("Cannot add a field that conflicts with the record key column");
  }
  const rows = getRows(model, collectionPath);
  if (applyToAll) {
    for (const row of rows) {
      if (isPlainObject(row) && !Object.hasOwn(row, fieldName)) row[fieldName] = value;
    }
    return rows.length;
  }
  const row = rows[rowIndex];
  if (!isPlainObject(row)) throw new Error("Selected row is not editable");
  row[fieldName] = value;
  return 1;
}

export function deleteField(model, collectionPath, fieldName) {
  if (isRecordMapModel(model) && collectionPath === objectMapCollectionPath && fieldName === model.rootKeyField) {
    throw new Error("Cannot delete the record key column");
  }
  let changed = 0;
  for (const row of getRows(model, collectionPath)) {
    if (isPlainObject(row) && Object.hasOwn(row, fieldName)) {
      delete row[fieldName];
      changed += 1;
    }
  }
  return changed;
}

function findCollections(root, objectMap) {
  if (Array.isArray(root)) return [{ path: "$", label: "$", rowCount: root.length }];
  if (objectMap) return [{ path: objectMapCollectionPath, label: objectMapCollectionPath, rowCount: Object.keys(root).length }];
  if (!isPlainObject(root)) return [];
  return Object.entries(root)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => ({ path: key, label: key, rowCount: value.length }));
}

function findMetadata(root, objectMap) {
  if (objectMap) return [];
  if (!isPlainObject(root) || Array.isArray(root)) return [];
  return Object.entries(root)
    .filter(([, value]) => !Array.isArray(value))
    .map(([key, value]) => ({ key, summary: summarizeMetadata(value) }));
}

function summarizeMetadata(value) {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (isPlainObject(value)) return `Object(${Object.keys(value).length})`;
  return String(value);
}

function isMainColumnValue(value) {
  if (Array.isArray(value)) return value.every((item) => item == null || typeof item !== "object");
  return value == null || typeof value !== "object";
}

function classifyFields(rows, ignoredField = null) {
  const fieldKinds = new Map();
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    for (const [key, value] of Object.entries(row)) {
      if (key === ignoredField) continue;
      const current = fieldKinds.get(key) ?? { main: false, nested: false };
      if (isMainColumnValue(value)) current.main = true;
      else current.nested = true;
      fieldKinds.set(key, current);
    }
  }

  const main = [];
  const nested = [];
  for (const [key, kind] of fieldKinds.entries()) {
    if (kind.nested) nested.push(key);
    else if (kind.main) main.push(key);
  }
  return { main, nested };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function detectObjectMapRoot(root) {
  if (!isPlainObject(root)) return null;
  const entries = Object.entries(root);
  if (!entries.length) return null;
  if (!entries.every(([, value]) => isPlainObject(value))) return null;
  const keyField = entries.some(([, value]) => Object.hasOwn(value, defaultObjectMapKeyField))
    ? fallbackObjectMapKeyField
    : defaultObjectMapKeyField;
  return { keyField };
}

function isRecordMapModel(model) {
  return model?.rootCollectionKind === "record-map" && isPlainObject(model.root);
}

function getRecordMapRows(root, keyField) {
  return Object.entries(root).map(([key, value]) => ({ [keyField]: key, ...value }));
}

function getRecordMapEntryAt(root, rowIndex) {
  const entry = Object.entries(root)[rowIndex];
  if (!entry) throw new Error("Selected row is out of range");
  return entry;
}

function stripRecordMapKey(row, keyField) {
  if (!isPlainObject(row)) return {};
  const next = { ...row };
  delete next[keyField];
  return next;
}

function createRecordMapKey(root) {
  let index = Object.keys(root).length + 1;
  while (Object.hasOwn(root, `item_${index}`)) index += 1;
  return `item_${index}`;
}

function getMutableArrayCollection(model, collectionPath) {
  if (isRecordMapModel(model) && collectionPath === objectMapCollectionPath) {
    throw new Error("Record-map collections do not support row ordering");
  }
  const rows = collectionPath === "$"
    ? model?.root
    : isPlainObject(model?.root)
      ? model.root[collectionPath]
      : null;
  if (!Array.isArray(rows)) throw new Error(`Collection is not an array: ${collectionPath}`);
  return rows;
}

function assertValidRowIndex(rows, rowIndex, label) {
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) {
    throw new Error(`Invalid ${label} row index: ${rowIndex}`);
  }
}

function cloneRow(row) {
  if (!isPlainObject(row)) throw new Error("Selected row is not editable");
  return structuredClone(row);
}

function applyDuplicatePrimaryKey(duplicate, rows, primaryKeyField, ignoredField = null) {
  if (!primaryKeyField || primaryKeyField === ignoredField || !Object.hasOwn(duplicate, primaryKeyField)) return;
  const result = resolveAutoSuffixedPrimaryKeyValue({
    rows,
    fieldName: primaryKeyField,
    value: duplicate[primaryKeyField],
  });
  duplicate[primaryKeyField] = result.value;
}

function renameRecordMapKey(root, currentKey, nextKeyValue) {
  const nextKey = String(nextKeyValue ?? "").trim();
  if (!nextKey) throw new Error("Record key cannot be empty");
  if (nextKey === currentKey) return;
  if (Object.hasOwn(root, nextKey)) throw new Error(`Record key already exists: ${nextKey}`);
  const entries = Object.entries(root).map(([key, value]) => key === currentKey ? [nextKey, value] : [key, value]);
  for (const key of Object.keys(root)) delete root[key];
  for (const [key, value] of entries) root[key] = value;
}
