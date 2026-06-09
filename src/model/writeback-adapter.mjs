import { addField, deleteRow, setCellValue, setNestedValue } from "../document-model.mjs";
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

export function setNestedValueByRowId({ model, store, collectionPath, rowId, pathParts, value }) {
  const locator = resolveRowLocatorById({ store, collectionPath, rowId });
  setNestedValue(model, collectionPath, locator.sourceIndex, pathParts, value);
}

export function deleteRowByRowId({ model, store, collectionPath, rowId }) {
  const locator = resolveRowLocatorById({ store, collectionPath, rowId });
  deleteRow(model, collectionPath, locator.sourceIndex);
}

export function addFieldByRowId({ model, store, collectionPath, rowId, fieldName, value, applyToAll = false }) {
  const locator = resolveRowLocatorById({ store, collectionPath, rowId });
  const changed = addField(model, collectionPath, locator.sourceIndex, fieldName, value, applyToAll);
  return changed;
}
