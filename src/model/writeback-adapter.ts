import type { DocumentModel } from "./documentModel";
import type { CollectionStore, DocumentStore, RowHandle } from "./document-store";
import type { RowId } from "./row-id";

export type CreateWritebackAdapterInput = {
  documentId?: string;
  model: DocumentModel;
};

export type WritebackAdapter = {
  model: DocumentModel;
  store: DocumentStore;
  getCollection(collectionPath: string): CollectionStore;
  getSourceLocatorByRowId(collectionPath: string, rowId: RowId): RowHandle;
  reopen(nextModel: DocumentModel): DocumentStore;
  setCellValueByRowId(collectionPath: string, rowId: RowId, fieldName: string, value: unknown): void;
  setNestedValueByRowId(collectionPath: string, rowId: RowId, pathParts: Array<string | number>, value: unknown): void;
  deleteRowByRowId(collectionPath: string, rowId: RowId): void;
  addFieldByRowId(
    collectionPath: string,
    rowId: RowId,
    fieldName: string,
    value: unknown,
    applyToAll?: boolean,
  ): number;
};

export {
  addFieldByRowId,
  createWritebackAdapter,
  deleteRowByRowId,
  resolveRowLocatorById,
  setCellValueByRowId,
  setNestedValueByRowId,
} from "./writeback-adapter.mjs";
