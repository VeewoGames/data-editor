import type { DataRecord, DocumentModel } from "./documentModel";
import type { RowId } from "./row-id";

export type RowHandle = {
  rowId: RowId;
  collectionPath: string;
  sourceIndex: number;
  sourceKey: string | null;
  sourceOrder: number;
};

export type TableRowView = {
  rowId: RowId;
  row: DataRecord;
  sourceIndex: number;
  sourceKey: string | null;
};

export type CollectionStore = {
  collectionPath: string;
  rowIds: RowId[];
  rowById: Map<RowId, DataRecord>;
  handleById: Map<RowId, RowHandle>;
  sourceIndexByRowId: Map<RowId, number>;
  rowViews: TableRowView[];
};

export type DocumentStore = {
  documentId: string;
  model: DocumentModel;
  collections: Map<string, CollectionStore>;
};

export type BuildDocumentStoreInput = {
  documentId?: string;
  model: DocumentModel;
  previousStore?: DocumentStore | null;
};

export {
  buildDocumentStore,
  getCollectionStore,
  getSourceLocatorByRowId,
  getTableRowViews,
} from "./document-store.mjs";
