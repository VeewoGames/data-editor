import {
  addField,
  deleteRow,
  duplicateRow,
  reorderRows,
  setCellValue,
  setNestedValue,
  getRows,
  prepareCellWrites,
} from "../document-model.mjs";
import { buildDocumentStore, getCollectionStore, getSourceLocatorByRowId } from "./document-store.mjs";

const capturedWriteTargets = new WeakMap();

export function createWritebackAdapter({ documentId = "document", model }) {
  let currentDocumentId = documentId;
  let currentModel = model;
  let currentStore = buildDocumentStore({ documentId: currentDocumentId, model });

  return {
    get model() {
      return currentModel;
    },
    get store() {
      return currentStore;
    },
    getCollection(collectionPath) {
      return getCollectionStore(currentStore, collectionPath);
    },
    getSourceLocatorByRowId(collectionPath, rowId) {
      return getSourceLocatorByRowId(currentStore, collectionPath, rowId);
    },
    reopen(nextModel) {
      currentModel = nextModel;
      currentStore = buildDocumentStore({
        documentId: currentDocumentId,
        model: nextModel,
        previousStore: currentStore,
      });
      return currentStore;
    },
    setCellValueByRowId(collectionPath, rowId, fieldName, value) {
      setCellValueByRowId({ model: currentModel, store: currentStore, collectionPath, rowId, fieldName, value });
      currentStore = buildDocumentStore({
        documentId: currentDocumentId,
        model: currentModel,
        previousStore: currentStore,
      });
    },
    setNestedValueByRowId(collectionPath, rowId, pathParts, value) {
      setNestedValueByRowId({ model: currentModel, store: currentStore, collectionPath, rowId, pathParts, value });
      currentStore = buildDocumentStore({
        documentId: currentDocumentId,
        model: currentModel,
        previousStore: currentStore,
      });
    },
    deleteRowByRowId(collectionPath, rowId) {
      deleteRowByRowId({ model: currentModel, store: currentStore, collectionPath, rowId });
      currentStore = buildDocumentStore({
        documentId: currentDocumentId,
        model: currentModel,
        previousStore: currentStore,
      });
    },
    reorderRowsByRowId(collectionPath, sourceRowId, targetRowId, placement) {
      const sourceLocator = resolveRowLocatorById({
        store: currentStore,
        collectionPath,
        rowId: sourceRowId,
      });
      const targetLocator = resolveRowLocatorById({
        store: currentStore,
        collectionPath,
        rowId: targetRowId,
      });
      const nextRowIds = reorderIdentityList(
        getCollectionStore(currentStore, collectionPath).rowIds,
        sourceLocator.sourceIndex,
        targetLocator.sourceIndex,
        placement,
      );
      const result = reorderRowsByRowId({
        model: currentModel,
        store: currentStore,
        collectionPath,
        sourceRowId,
        targetRowId,
        placement,
      });
      currentStore = buildDocumentStore({
        documentId: currentDocumentId,
        model: currentModel,
        previousStore: currentStore,
        collectionIdentityOverrides: new Map([[collectionPath, nextRowIds]]),
      });
      return {
        rowId: sourceRowId,
        sourceIndex: result.sourceIndex,
        sourceKey: result.sourceKey,
      };
    },
    duplicateRowByRowId(collectionPath, rowId, primaryKeyField = null) {
      const sourceLocator = resolveRowLocatorById({
        store: currentStore,
        collectionPath,
        rowId,
      });
      const nextLocator = duplicateRow(
        currentModel,
        collectionPath,
        sourceLocator,
        primaryKeyField,
      );
      currentStore = buildDocumentStore({
        documentId: currentDocumentId,
        model: currentModel,
        previousStore: currentStore,
      });
      return resolveInsertedRow(currentStore, collectionPath, nextLocator);
    },
    addFieldByRowId(collectionPath, rowId, fieldName, value, applyToAll = false) {
      const changed = addFieldByRowId({ model: currentModel, store: currentStore, collectionPath, rowId, fieldName, value, applyToAll });
      currentStore = buildDocumentStore({
        documentId: currentDocumentId,
        model: currentModel,
        previousStore: currentStore,
      });
      return changed;
    },
  };
}

export function resolveRowLocatorById({ store, collectionPath, rowId }) {
  return getSourceLocatorByRowId(store, collectionPath, rowId);
}

function readCellWriteTarget({model, store, collectionPath, rowId, fieldName}) {
  if (store.model !== model || typeof rowId !== "string" || !rowId || typeof fieldName !== "string") throw new Error("Selected document no longer matches the store");
  const handle = getCollectionStore(store, collectionPath).handleById.get(rowId);
  if (!handle) throw new Error("Selected row no longer matches the document");
  const recordMap = collectionPath === "$" && model.rootCollectionKind === "record-map";
  const row = recordMap ? Object.getOwnPropertyDescriptor(model.root, handle.sourceKey)?.value : getRows(model, collectionPath)[handle.sourceIndex];
  if (row !== handle.sourceValue || !row || typeof row !== "object" || Array.isArray(row)) throw new Error("Selected row no longer matches the document");
  const syntheticKey = recordMap && fieldName === model.rootKeyField;
  const descriptor = syntheticKey ? {value: handle.sourceKey} : Object.getOwnPropertyDescriptor(row, fieldName);
  if (descriptor && !("value" in descriptor)) throw new Error("Cell is not a JSON data field");
  const value = descriptor?.value;
  const valueStamp = !descriptor ? "missing" : value === undefined ? "undefined" : JSON.stringify(value);
  return {rowId, fieldName, expectedSource: row, expectedValueStamp: valueStamp};
}

export function captureCellWriteTarget(input) {
  const target = Object.freeze(readCellWriteTarget(input));
  capturedWriteTargets.set(target, {model: input.model, documentId: input.store.documentId, collectionPath: input.collectionPath});
  return target;
}

export function validateCellWriteTarget({model,store,collectionPath,target}) {
  const context = target && capturedWriteTargets.get(target);
  if (!context || context.model !== model || context.documentId !== store.documentId || context.collectionPath !== collectionPath) throw new Error("A captured cell target for the same document and collection is required");
  const current = readCellWriteTarget({model,store,collectionPath,rowId:target.rowId,fieldName:target.fieldName});
  if (current.expectedSource !== target.expectedSource) throw new Error("Selected row no longer matches the document");
  if (current.expectedValueStamp !== target.expectedValueStamp) throw new Error("Selected cell changed since capture");
  return target;
}

export function prepareCellWritesByRowId({model, store, collectionPath, writes}) {
  if (store.model !== model || !Array.isArray(writes)) throw new Error("Selected document no longer matches the store");
  const collection = getCollectionStore(store, collectionPath);
  const recordMap = collectionPath === "$" && model.rootCollectionKind === "record-map";
  const rows = recordMap ? null : getRows(model, collectionPath);
  const rootKeys = recordMap && writes.some(write => write.target?.fieldName === model.rootKeyField) ? Object.keys(model.root) : null;
  const resolved = writes.map(write => {
    const target = validateCellWriteTarget({model,store,collectionPath,target:write.target});
    const handle = collection.handleById.get(target.rowId);
    const actual = recordMap ? Object.getOwnPropertyDescriptor(model.root, handle.sourceKey)?.value : rows[handle.sourceIndex];
    if (actual !== handle.sourceValue || (rootKeys && rootKeys[handle.sourceIndex] !== handle.sourceKey)) throw new Error("Selected row no longer matches the document");
    return {value:write.value,witnessOnly:write.witnessOnly,fieldName:target.fieldName,rowIndex:handle.sourceIndex,sourceKey:handle.sourceKey,sourceValue:handle.sourceValue};
  });
  return prepareCellWrites(model, collectionPath, resolved);
}

export function setCellValueByRowId({ model, store, collectionPath, rowId, fieldName, value }) {
  const locator = resolveRowLocatorById({ store, collectionPath, rowId });
  if (collectionPath === "$" && model.rootCollectionKind === "record-map") {
    const handle = getCollectionStore(store, collectionPath).handleById.get(rowId);
    const root = model.root;
    if (store.model !== model || !root || typeof root !== "object" || Array.isArray(root) ||
        locator.sourceKey == null || !Object.hasOwn(root, locator.sourceKey) ||
        root[locator.sourceKey] !== handle?.sourceValue || !root[locator.sourceKey] ||
        typeof root[locator.sourceKey] !== "object" || Array.isArray(root[locator.sourceKey])) {
      throw new Error("Selected row no longer matches the document");
    }
    if (fieldName === model.rootKeyField) {
      if (Object.keys(root)[locator.sourceIndex] !== locator.sourceKey) throw new Error("Selected row no longer matches the document");
      setCellValue(model, collectionPath, locator.sourceIndex, fieldName, value);
    } else {
      root[locator.sourceKey][fieldName] = value;
    }
    return;
  }
  setCellValue(model, collectionPath, locator.sourceIndex, fieldName, value);
}

/** Applies one patch after the entry-action authority layer has validated it. */
export function setAuthorizedCellValueByRowId({ model, store, collectionPath, rowId, fieldName, value }) {
  setCellValueByRowId({ model, store, collectionPath, rowId, fieldName, value });
}

export function setNestedValueByRowId({ model, store, collectionPath, rowId, pathParts, value }) {
  const locator = resolveRowLocatorById({ store, collectionPath, rowId });
  setNestedValue(model, collectionPath, locator.sourceIndex, pathParts, value);
}

export function deleteRowByRowId({ model, store, collectionPath, rowId }) {
  const locator = resolveRowLocatorById({ store, collectionPath, rowId });
  deleteRow(model, collectionPath, locator.sourceIndex);
}

export function reorderRowsByRowId({
  model,
  store,
  collectionPath,
  sourceRowId,
  targetRowId,
  placement,
}) {
  if (!sourceRowId || !targetRowId) throw new Error("Source and target rowId are required");
  if (sourceRowId === targetRowId) throw new Error("Source and target rows must be different");
  const sourceLocator = resolveRowLocatorById({ store, collectionPath, rowId: sourceRowId });
  const targetLocator = resolveRowLocatorById({ store, collectionPath, rowId: targetRowId });
  return reorderRows(
    model,
    collectionPath,
    sourceLocator.sourceIndex,
    targetLocator.sourceIndex,
    placement,
  );
}

export function duplicateRowByRowId({
  documentId = "document",
  model,
  store,
  collectionPath,
  rowId,
  primaryKeyField = null,
}) {
  const sourceLocator = resolveRowLocatorById({ store, collectionPath, rowId });
  const nextLocator = duplicateRow(model, collectionPath, sourceLocator, primaryKeyField);
  const nextStore = buildDocumentStore({
    documentId: store?.documentId ?? documentId,
    model,
    previousStore: store,
  });
  return resolveInsertedRow(nextStore, collectionPath, nextLocator);
}

export function addFieldByRowId({ model, store, collectionPath, rowId, fieldName, value, applyToAll = false }) {
  const locator = resolveRowLocatorById({ store, collectionPath, rowId });
  const changed = addField(model, collectionPath, locator.sourceIndex, fieldName, value, applyToAll);
  return changed;
}

function resolveInsertedRow(store, collectionPath, locator) {
  const collection = getCollectionStore(store, collectionPath);
  const duplicateView = collection.rowViews.find((rowView) => (
    rowView.sourceIndex === locator.sourceIndex
    && rowView.sourceKey === locator.sourceKey
  ));
  if (!duplicateView) throw new Error("Duplicated row could not be resolved");
  return {
    rowId: duplicateView.rowId,
    sourceIndex: duplicateView.sourceIndex,
    sourceKey: duplicateView.sourceKey,
  };
}

function reorderIdentityList(rowIds, sourceIndex, targetIndex, placement) {
  if (!Array.isArray(rowIds)) throw new Error("Collection row identities are unavailable");
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= rowIds.length) {
    throw new Error(`Invalid source row index: ${sourceIndex}`);
  }
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= rowIds.length) {
    throw new Error(`Invalid target row index: ${targetIndex}`);
  }
  if (sourceIndex === targetIndex) throw new Error("Source and target rows must be different");
  if (placement !== "before" && placement !== "after") {
    throw new Error(`Invalid row placement: ${placement}`);
  }
  const nextRowIds = [...rowIds];
  const [movedRowId] = nextRowIds.splice(sourceIndex, 1);
  let nextIndex = targetIndex;
  if (sourceIndex < targetIndex) nextIndex -= 1;
  if (placement === "after") nextIndex += 1;
  nextRowIds.splice(nextIndex, 0, movedRowId);
  return nextRowIds;
}
