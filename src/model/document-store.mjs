import { attachRowId, readRowId } from "./row-id.mjs";
import { readPersistentEntryId } from "./persistent-entry-id.mjs";

const negativeZeroIdentityKey = Object.freeze({ type: "negative-zero" });

export function buildDocumentStore({
  documentId = "document",
  model,
  previousStore = null,
  collectionIdentityOverrides = null,
}) {
  const collections = new Map();
  for (const collectionInfo of model.collections ?? []) {
    collections.set(
      collectionInfo.path,
      buildCollectionStore(
        documentId,
        model,
        collectionInfo.path,
        previousStore?.collections?.get(collectionInfo.path) ?? null,
        collectionIdentityOverrides?.get?.(collectionInfo.path) ?? null,
      ),
    );
  }
  return {
    documentId,
    model,
    collections,
  };
}

export function getCollectionStore(store, collectionPath) {
  const collection = store.collections.get(collectionPath);
  if (!collection) throw new Error(`Unknown collection path: ${collectionPath}`);
  return collection;
}

export function getTableRowViews(store, collectionPath) {
  return getCollectionStore(store, collectionPath).rowViews;
}

export function getSourceLocatorByRowId(store, collectionPath, rowId) {
  const handle = getCollectionStore(store, collectionPath).handleById.get(rowId);
  if (!handle) throw new Error(`Unknown rowId: ${rowId}`);
  return {
    collectionPath: handle.collectionPath,
    rowId: handle.rowId,
    sourceIndex: handle.sourceIndex,
    sourceKey: handle.sourceKey,
    sourceOrder: handle.sourceOrder,
  };
}

function buildCollectionStore(
  documentId,
  model,
  collectionPath,
  previousCollection = null,
  identityOverride = null,
) {
  const sourceEntries = getSourceEntries(model, collectionPath);
  const rowIds = [];
  const rowById = new Map();
  const handleById = new Map();
  const sourceIndexByRowId = new Map();
  const rowViews = [];
  const resolvedEntries = resolveEntryIdentity(
    sourceEntries,
    previousCollection,
    identityOverride,
  );

  sourceEntries.forEach((entry, index) => {
    const resolved = resolvedEntries[index];
    const persistedRowId = readPersistentEntryId(entry.sourceRow);
    const rowId = resolved.rowId ?? persistedRowId ?? buildFreshRowId(documentId, collectionPath, resolved.sourceOrder);
    attachRowId(entry.sourceRow, rowId);
    const row = createRowView(model, entry.sourceKey, entry.sourceRow);
    const handle = {
      rowId,
      collectionPath,
      sourceIndex: entry.sourceIndex,
      sourceKey: entry.sourceKey,
      sourceOrder: resolved.sourceOrder,
      sourceValue: entry.sourceRow,
    };
    rowIds.push(rowId);
    rowById.set(rowId, row);
    handleById.set(rowId, handle);
    sourceIndexByRowId.set(rowId, entry.sourceIndex);
    rowViews.push({
      rowId,
      row,
      sourceIndex: entry.sourceIndex,
      sourceKey: entry.sourceKey,
    });
  });

  return {
    collectionPath,
    rowIds,
    rowById,
    handleById,
    sourceIndexByRowId,
    rowViews,
  };
}

function getSourceEntries(model, collectionPath) {
  if (isRootRecordMap(model, collectionPath)) {
    return Object.entries(model.root).map(([sourceKey, sourceRow], sourceIndex) => ({
      sourceIndex,
      sourceOrder: sourceIndex,
      sourceKey,
      sourceRow,
    }));
  }

  const collection = getSourceCollection(model, collectionPath);
  return collection.map((sourceRow, sourceIndex) => ({
    sourceIndex,
    sourceOrder: sourceIndex,
    sourceKey: null,
    sourceRow,
  }));
}

function buildFreshRowId(documentId, collectionPath, sourceOrder) {
  return `${documentId}:${collectionPath}:${sourceOrder}`;
}

function resolveEntryIdentity(sourceEntries, previousCollection, identityOverride = null) {
  if (identityOverride) {
    return resolveExplicitIdentityOverride(sourceEntries, previousCollection, identityOverride);
  }
  if (!previousCollection) {
    return sourceEntries.map((entry) => ({
      rowId: readRowId(entry.sourceRow),
      sourceOrder: entry.sourceOrder,
    }));
  }

  const previousHandlesByRowId = new Map(previousCollection.handleById);
  const previousRowIdByKey = new Map();
  const previousPrimitiveHandleQueues = new Map();
  let nextFreshSourceOrder = 0;
  for (const rowId of previousCollection.rowIds) {
    const handle = previousHandlesByRowId.get(rowId);
    if (!handle) continue;
    if (handle.sourceKey != null) previousRowIdByKey.set(handle.sourceKey, rowId);
    else if (!isIdentityCarrier(handle.sourceValue)) {
      const key = getPrimitiveIdentityKey(handle.sourceValue);
      const queue = previousPrimitiveHandleQueues.get(key) ?? { handles: [], cursor: 0 };
      queue.handles.push(handle);
      previousPrimitiveHandleQueues.set(key, queue);
    }
    nextFreshSourceOrder = Math.max(nextFreshSourceOrder, handle.sourceOrder + 1);
  }

  const usedRowIds = new Set();
  const usedSourceOrders = new Set();
  return sourceEntries.map((entry) => {
    const existingRowId = readRowId(entry.sourceRow);
    const existingHandle = existingRowId ? previousHandlesByRowId.get(existingRowId) : null;
    if (existingHandle && !usedRowIds.has(existingHandle.rowId)) {
      usedRowIds.add(existingHandle.rowId);
      usedSourceOrders.add(existingHandle.sourceOrder);
      return { rowId: existingHandle.rowId, sourceOrder: existingHandle.sourceOrder };
    }

    const keyMatchRowId = entry.sourceKey != null ? previousRowIdByKey.get(entry.sourceKey) : null;
    const keyMatchHandle = keyMatchRowId ? previousHandlesByRowId.get(keyMatchRowId) : null;
    if (keyMatchHandle && !usedRowIds.has(keyMatchHandle.rowId)) {
      usedRowIds.add(keyMatchHandle.rowId);
      usedSourceOrders.add(keyMatchHandle.sourceOrder);
      return { rowId: keyMatchHandle.rowId, sourceOrder: keyMatchHandle.sourceOrder };
    }

    if (!isIdentityCarrier(entry.sourceRow)) {
      const queue = previousPrimitiveHandleQueues.get(getPrimitiveIdentityKey(entry.sourceRow));
      const valueMatchHandle = queue?.handles[queue.cursor];
      if (valueMatchHandle) {
        queue.cursor += 1;
        usedRowIds.add(valueMatchHandle.rowId);
        usedSourceOrders.add(valueMatchHandle.sourceOrder);
        return {
          rowId: valueMatchHandle.rowId,
          sourceOrder: valueMatchHandle.sourceOrder,
        };
      }
    }

    while (usedSourceOrders.has(nextFreshSourceOrder)) nextFreshSourceOrder += 1;
    const sourceOrder = nextFreshSourceOrder;
    usedSourceOrders.add(sourceOrder);
    nextFreshSourceOrder += 1;
    return { rowId: null, sourceOrder };
  });
}

function resolveExplicitIdentityOverride(sourceEntries, previousCollection, identityOverride) {
  if (!previousCollection) {
    throw new Error("Collection identity override requires a previous collection");
  }
  if (
    !Array.isArray(identityOverride)
    || identityOverride.length !== sourceEntries.length
    || identityOverride.length !== previousCollection.rowIds.length
  ) {
    throw new Error("Collection identity override must preserve the previous collection length");
  }
  const previousHandlesByRowId = previousCollection.handleById;
  const previousRowIds = new Set(previousCollection.rowIds);
  const usedRowIds = new Set();
  const resolved = identityOverride.map((rowId, sourceIndex) => {
    if (typeof rowId !== "string" || !rowId) {
      throw new Error(`Invalid overridden rowId at source index ${sourceIndex}`);
    }
    if (!previousRowIds.has(rowId)) {
      throw new Error(`Unknown overridden rowId: ${rowId}`);
    }
    if (usedRowIds.has(rowId)) {
      throw new Error(`Duplicate overridden rowId: ${rowId}`);
    }
    usedRowIds.add(rowId);
    const previousHandle = previousHandlesByRowId.get(rowId);
    if (!previousHandle) {
      throw new Error(`Missing previous row handle: ${rowId}`);
    }
    return {
      rowId,
      sourceOrder: previousHandle.sourceOrder,
    };
  });
  if (usedRowIds.size !== previousRowIds.size) {
    const missingRowId = previousCollection.rowIds.find((rowId) => !usedRowIds.has(rowId));
    throw new Error(`Missing overridden rowId: ${missingRowId}`);
  }
  return resolved;
}

function getSourceCollection(model, collectionPath) {
  if (collectionPath === "$") {
    if (Array.isArray(model.root)) return model.root;
    return [];
  }
  if (!isPlainObject(model.root)) return [];
  const collection = model.root[collectionPath];
  return Array.isArray(collection) ? collection : [];
}

function createRowView(model, sourceKey, sourceRow) {
  const row = isPlainObject(sourceRow) ? { ...sourceRow } : {};
  if (isRootRecordMap(model, "$") && sourceKey != null) {
    return { [model.rootKeyField]: sourceKey, ...row };
  }
  return row;
}

function isRootRecordMap(model, collectionPath) {
  return collectionPath === "$" && model?.rootCollectionKind === "record-map" && isPlainObject(model.root);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIdentityCarrier(value) {
  return Boolean(value) && (typeof value === "object" || typeof value === "function");
}

function getPrimitiveIdentityKey(value) {
  return typeof value === "number" && Object.is(value, -0)
    ? negativeZeroIdentityKey
    : value;
}
