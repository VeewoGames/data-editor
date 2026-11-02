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

export function getCollectionFields(model, collectionPath, rows = getRows(model, collectionPath)) {
  const recordMap = isRecordMapModel(model) && collectionPath === objectMapCollectionPath;
  const fields = classifyFields(rows, recordMap ? model.rootKeyField : null);
  return {main: recordMap ? [model.rootKeyField, ...buildVisibleFieldList(fields.main)] : buildVisibleFieldList(fields.main), nested: buildVisibleFieldList(fields.nested)};
}
export function getMainColumns(model, collectionPath) { return getCollectionFields(model, collectionPath).main; }
export function getNestedFields(model, collectionPath) { return getCollectionFields(model, collectionPath).nested; }

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
  const nextKey = validateRecordMapKeyRename(root, currentKey, nextKeyValue);
  if (nextKey === currentKey) return;
  const entries = Object.entries(root).map(([key, value]) => key === currentKey ? [nextKey, value] : [key, value]);
  for (const key of Object.keys(root)) delete root[key];
  for (const [key, value] of entries) root[key] = value;
}

function validateRecordMapKeyRename(root, currentKey, nextKeyValue) {
  const nextKey = String(nextKeyValue ?? "").trim();
  if (!nextKey) throw new Error("Record key cannot be empty");
  if (nextKey === currentKey) return nextKey;
  if (Object.hasOwn(root, nextKey)) throw new Error(`Record key already exists: ${nextKey}`);
  return nextKey;
}

function sameWriteDescriptor(a, b) {
  if (a === undefined || b === undefined) return a === b;
  if (a.enumerable !== b.enumerable || a.configurable !== b.configurable || ("value" in a) !== ("value" in b)) return false;
  return "value" in a ? Object.is(a.value, b.value) && a.writable === b.writable : a.get === b.get && a.set === b.set;
}

function writableDataDescriptor(target, key) {
  const prototype = Object.getPrototypeOf(target);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("Selected row is not a JSON record");
  const before = Object.getOwnPropertyDescriptor(target, key);
  if (before ? !("value" in before) || !before.writable : !Object.isExtensible(target)) {
    throw new Error(`Field is not writable: ${key}`);
  }
  return before;
}

function cellWriteValueStamp(value) {
  return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
}

/** Prepared synchronous writes for serialized JSON/CSV data. No root deep copy. */
export function prepareCellWrites(model, collectionPath, writes) {
  if (!Array.isArray(writes)) throw new Error("Invalid cell write list");
  const root = model.root, recordMap = isRecordMapModel(model) && collectionPath === objectMapCollectionPath;
  const rows = recordMap ? null : getRows(model, collectionPath);
  const fields = [], keys = [], targets = new Map();
  let rootBefore = null, rootAfter = null, nextKeyByOriginal = new Map(), rootProtected = null;
  if (recordMap && writes.some(write => write.fieldName === model.rootKeyField)) {
    rootProtected = Reflect.ownKeys(root).filter(key => typeof key === "symbol" || !Object.getOwnPropertyDescriptor(root, key).enumerable).map(key => [key, Object.getOwnPropertyDescriptor(root, key)]);
    rootBefore = Object.keys(root).map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(root, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.configurable) throw new Error("Record keys are not writable");
      return [key, descriptor];
    });
  }
  for (const write of writes) {
    if (!Number.isSafeInteger(write.rowIndex) || write.rowIndex < 0 || typeof write.fieldName !== "string" || (recordMap && typeof write.sourceKey !== "string")) throw new Error("Invalid cell write target");
    const key = recordMap ? write.sourceKey : null;
    const row = recordMap ? Object.getOwnPropertyDescriptor(root, key)?.value : rows[write.rowIndex];
    if (!isPlainObject(row) || row !== write.sourceValue) throw new Error("Selected row no longer matches the document");
    const seen = targets.get(row) ?? new Set();
    if (seen.has(write.fieldName)) throw new Error("Duplicate planned cell write");
    seen.add(write.fieldName); targets.set(row, seen);
    if (recordMap && write.fieldName === model.rootKeyField) {
      if (rootBefore[write.rowIndex]?.[0] !== key) throw new Error("Selected row no longer matches the document");
      const nextKey = write.witnessOnly ? key : String(write.value ?? "").trim();
      if (!nextKey) throw new Error("Record key cannot be empty");
      if (nextKey !== key) keys.push({key, nextKey});
      continue;
    }
    const before = writableDataDescriptor(row, write.fieldName);
    fields.push({row, key: write.fieldName, changed: !write.witnessOnly && !(before && Object.is(before.value, write.value)), before, beforeStamp: cellWriteValueStamp(before?.value), afterStamp: cellWriteValueStamp(write.witnessOnly ? before?.value : write.value), after: write.witnessOnly ? before : before ? {...before, value: write.value} : {value: write.value, writable: true, enumerable: true, configurable: true}, rowIndex: write.rowIndex, sourceKey: key});
  }
  if (keys.length) {
    if (!Object.isExtensible(root)) throw new Error("Record keys are not writable");
    const finalKeys = new Map(keys.map(item => [item.key, item.nextKey]));
    nextKeyByOriginal = finalKeys;
    const unique = new Set();
    for (const [key] of rootBefore) {
      const next = finalKeys.get(key) ?? key;
      if (unique.has(next)) throw new Error(`Record key already exists: ${next}`);
      unique.add(next);
    }
    // Respect the existing per-key collision rule; dependencies may move first.
    const virtual = Object.create(null), waiting = new Map(keys.map(item => [item.key, item])), dependents = new Map(), ready = [];
    for (const key of Reflect.ownKeys(root)) Object.defineProperty(virtual, key, {value: true, writable: true, enumerable: true, configurable: true});
    for (const item of keys) {
      if (!Object.hasOwn(virtual, item.nextKey)) ready.push(item.key);
      else if (waiting.has(item.nextKey)) dependents.set(item.nextKey, item.key);
      else throw new Error(`Record key already exists: ${item.nextKey}`);
    }
    for (let i = 0; i < ready.length; i++) {
      const item = waiting.get(ready[i]);
      const next = validateRecordMapKeyRename(virtual, item.key, item.nextKey), value = virtual[item.key];
      delete virtual[item.key]; Object.defineProperty(virtual, next, {value, writable: true, enumerable: true, configurable: true});
      waiting.delete(item.key);
      if (dependents.has(item.key)) ready.push(dependents.get(item.key));
    }
    if (waiting.size) throw new Error("Record key rename cycle conflicts with existing keys");
    rootAfter = rootBefore.map(([key, descriptor]) => [finalKeys.get(key) ?? key, descriptor]);
    // JavaScript's numeric-key ordering also applies to the real root.
    const ordered = Object.create(null);for (const [key, descriptor] of rootAfter) Object.defineProperty(ordered, key, descriptor);
    rootAfter = Object.keys(ordered).map(key => [key, Object.getOwnPropertyDescriptor(ordered, key)]);
  }
  let state = "prepared", rootProgress = null;
  const attempted = new Set();
  function matchesRoot(entries) {
    const actual = Object.keys(root);
    return actual.length === entries.length && actual.every((key, index) => key === entries[index][0] && sameWriteDescriptor(Object.getOwnPropertyDescriptor(root, key), entries[index][1]));
  }
  function assertProtectedRoot() {
    if (!rootProtected) return;
    const actual = Reflect.ownKeys(root).filter(key => typeof key === "symbol" || !Object.getOwnPropertyDescriptor(root, key).enumerable);
    if (actual.length !== rootProtected.length || actual.some((key, i) => key !== rootProtected[i][0] || !sameWriteDescriptor(Object.getOwnPropertyDescriptor(root, key), rootProtected[i][1]))) throw new Error("Record metadata write conflict");
  }
  function assertRoot(entries) {
    if (model.root !== root || (!recordMap && getRows(model, collectionPath) !== rows)) throw new Error("Document write plan is stale");
    if (rootAfter && !Object.isExtensible(root)) throw new Error("Record keys are not writable");
    assertProtectedRoot();
    if (entries) {
      if (!matchesRoot(entries)) throw new Error("Record key write plan is stale");
    }
  }
  function fieldMatches(write, descriptor, stamp) {
    return sameWriteDescriptor(Object.getOwnPropertyDescriptor(write.row, write.key), descriptor) && cellWriteValueStamp(descriptor?.value) === stamp;
  }
  function assertFieldOwner(write, afterKeys = false) {
    if (model.root !== root || (!recordMap && getRows(model, collectionPath) !== rows)) throw new Error("Document write owner changed");
    const key = afterKeys ? nextKeyByOriginal.get(write.sourceKey) ?? write.sourceKey : write.sourceKey;
    const row = recordMap ? Object.getOwnPropertyDescriptor(root, key)?.value : rows[write.rowIndex];
    if (row !== write.row) throw new Error("Document write row changed");
  }
  function replaceRoot(entries) {
    for (const key of Object.keys(root)) {
      if (!sameWriteDescriptor(Object.getOwnPropertyDescriptor(root, key), rootProgress.map.get(key))) throw new Error("Record key write conflict");
      rootProgress.pending = {key, descriptor: undefined};
      delete root[key];rootProgress.map.delete(key);rootProgress.pending = null;
    }
    for (const [key, descriptor] of entries) {
      if (!sameWriteDescriptor(Object.getOwnPropertyDescriptor(root, key), rootProgress.map.get(key))) throw new Error("Record key write conflict");
      rootProgress.pending = {key, descriptor};
      Object.defineProperty(root, key, descriptor);rootProgress.map.set(key, descriptor);rootProgress.pending = null;
    }
  }
  function assertRollbackPrefix() {
    if (model.root !== root || (!recordMap && getRows(model, collectionPath) !== rows)) throw new Error("Document rollback owner changed");
    assertProtectedRoot();
    if (rootProgress) {
      if (!Object.isExtensible(root)) throw new Error("Record keys are not writable");
      const before = [...rootProgress.map], candidate = new Map(before), pending = rootProgress.pending;
      if (pending) {if (pending.descriptor) candidate.set(pending.key, pending.descriptor);else candidate.delete(pending.key);}
      if (!matchesRoot(before) && (!pending || !matchesRoot([...candidate]))) throw new Error("Record key rollback conflict");
      rootProgress = {map: new Map(Object.keys(root).map(key => [key, Object.getOwnPropertyDescriptor(root, key)])), pending: null};
    } else assertRoot(rootBefore);
    for (const write of fields) {
      if (!rootProgress) {
        const row = recordMap ? Object.getOwnPropertyDescriptor(root, write.sourceKey)?.value : rows[write.rowIndex];
        if (row !== write.row) throw new Error("Document rollback row changed");
      }
      if (!fieldMatches(write, write.before, write.beforeStamp) && (!attempted.has(write) || !fieldMatches(write, write.after, write.afterStamp))) throw new Error("Cell rollback conflict");
    }
  }
  function restore() {
    assertRollbackPrefix();
    if (rootProgress) replaceRoot(rootBefore);
    for (let i = fields.length - 1; i >= 0; i--) {
      const write = fields[i];
      assertFieldOwner(write);
      if (!attempted.has(write) || fieldMatches(write, write.before, write.beforeStamp)) continue;
      if (!fieldMatches(write, write.after, write.afterStamp)) throw new Error("Cell rollback conflict");
      if (write.before) Object.defineProperty(write.row, write.key, write.before);else delete write.row[write.key];
    }
    assertRoot(rootBefore);
    for (const write of fields) {assertFieldOwner(write);if (!fieldMatches(write, write.before, write.beforeStamp)) throw new Error("Cell rollback conflict");}
  }
  function assertApplied() {
    if (state !== "applied") throw new Error("Document write plan is not applied");
    assertRoot(rootAfter ?? rootBefore);
    for (const write of fields) {assertFieldOwner(write,true);if (!fieldMatches(write,write.after,write.afterStamp)) throw new Error("Applied write was changed; refusing rollback");}
  }
  function assertPrepared() {
    if (state !== "prepared") throw new Error("Document write plan has already been used");
    assertRoot(rootBefore);
    for (const write of fields) {
      assertFieldOwner(write);
      if (!fieldMatches(write,write.before,write.beforeStamp) || cellWriteValueStamp(write.after?.value) !== write.afterStamp) throw new Error("Cell write plan is stale");
      writableDataDescriptor(write.row,write.key);
    }
  }
  return {
    get state() { return state; },
    get changed() { return fields.some(write => write.changed) || rootAfter !== null; },
    assertApplied,
    assertPrepared,
    apply() {
      assertPrepared();
      state = "applying";
      try {
        for (const write of fields) {
          const row = recordMap ? Object.getOwnPropertyDescriptor(root, write.sourceKey)?.value : rows[write.rowIndex];
          if (model.root !== root || (!recordMap && getRows(model, collectionPath) !== rows) || row !== write.row || !fieldMatches(write, write.before, write.beforeStamp)) throw new Error("Cell changed during document write");
          if (write.changed) {attempted.add(write);Object.defineProperty(write.row, write.key, write.after);}
        }
        if (rootAfter) {rootProgress = {map: new Map(rootBefore), pending: null};replaceRoot(rootAfter);}
        assertRoot(rootAfter ?? rootBefore);
        for (const write of fields) {assertFieldOwner(write,true);if (!fieldMatches(write, write.after, write.afterStamp)) throw new Error("Cell changed during document write");}
        state = "applied";
      } catch (cause) {
        try { restore(); state = "rolled-back"; } catch (rollbackError) { state = "partial";throw Object.assign(new Error("Document write rollback failed", {cause}), {code: "DOCUMENT_WRITE_ROLLBACK_FAILED", rollbackError}); }
        throw cause;
      }
    },
    rollback() {
      assertApplied();
      try { restore(); state = "rolled-back"; } catch (cause) { state = "partial";throw Object.assign(new Error("Document write rollback failed", {cause}), {code: "DOCUMENT_WRITE_ROLLBACK_FAILED"}); }
    },
  };
}
