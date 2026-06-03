import { setByPath } from "./path-utils.mjs";

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
    return [model.rootKeyField, ...fields.main];
  }
  return classifyFields(getRows(model, collectionPath)).main;
}

export function getNestedFields(model, collectionPath) {
  return classifyFields(
    getRows(model, collectionPath),
    isRecordMapModel(model) && collectionPath === objectMapCollectionPath ? model.rootKeyField : null,
  ).nested;
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

function renameRecordMapKey(root, currentKey, nextKeyValue) {
  const nextKey = String(nextKeyValue ?? "").trim();
  if (!nextKey) throw new Error("Record key cannot be empty");
  if (nextKey === currentKey) return;
  if (Object.hasOwn(root, nextKey)) throw new Error(`Record key already exists: ${nextKey}`);
  const entries = Object.entries(root).map(([key, value]) => key === currentKey ? [nextKey, value] : [key, value]);
  for (const key of Object.keys(root)) delete root[key];
  for (const [key, value] of entries) root[key] = value;
}
