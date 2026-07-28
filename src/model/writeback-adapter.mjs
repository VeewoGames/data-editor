import {
  addField,
  deleteRow,
  duplicateRow,
  reorderRows,
  setCellValue,
  setNestedValue,
} from "../document-model.mjs";
import { validateAuthorizedPatch } from "../entry-action-policy.mjs";
import { buildDocumentStore, getCollectionStore, getSourceLocatorByRowId } from "./document-store.mjs";

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

export function setCellValueByRowId({ model, store, collectionPath, rowId, fieldName, value }) {
  const locator = resolveRowLocatorById({ store, collectionPath, rowId });
  setCellValue(model, collectionPath, locator.sourceIndex, fieldName, value);
}

/** Applies one already-authorized policy patch; it never derives authority itself. */
export function setAuthorizedCellValueByRowId({ model, store, policy, file, collectionPath, rowId, fieldName, value }) {
  validateAuthorizedPatch({ policy, file, collection: collectionPath, field: fieldName, value });
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
