export type DataRecord = Record<string, unknown>;
export type CollectionInfo = { path: string; label: string; rowCount: number };
export type DocumentModel = {
  format: "json" | "csv";
  sourcePath: string;
  root: unknown;
  rootKind: "array" | "object";
  collections: CollectionInfo[];
  metadata?: { key: string; summary: string }[];
  rootCollectionKind?: "record-map";
  rootKeyField?: string;
};

export {
  addField,
  addRow,
  buildDocumentModel,
  deleteField,
  deleteRow,
  getMainColumns,
  getNestedFields,
  getRows,
  setCellValue,
  setNestedValue,
  summarizeNested,
} from "../document-model.mjs";

export function displayConfigKey(path: string, collectionPath: string, fieldName: string, suffix: string): string {
  return `data-editor:${path}:${collectionPath}:${fieldName}:${suffix}`;
}
