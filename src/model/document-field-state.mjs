import { buildDocumentFieldKey } from "./document-config.mjs";

/**
 * @param {{
 *   sourcePath: string | null;
 *   collectionPath: string;
 *   row: Record<string, unknown> | null | undefined;
 *   primaryKeyField: string | null;
 *   displayTypes: Record<string, import("./fieldTypes").FieldDisplayType>;
 *   documentFieldConfigs: Record<string, { enabled: true }>;
 *   documentIndexEntries: Record<string, import("../api/client").DocumentIndexEntry>;
 * }} input
 */
export function buildSelectedDocumentFields({
  sourcePath,
  collectionPath,
  row,
  primaryKeyField,
  displayTypes,
  documentFieldConfigs,
  documentIndexEntries,
}) {
  if (!sourcePath || !row) return [];
  const primaryKeyValue = primaryKeyField ? row[primaryKeyField] : null;
  const documentId = primaryKeyValue == null ? "" : String(primaryKeyValue).trim();
  const sharedIndexEntry = documentId ? documentIndexEntries[documentId] ?? null : null;
  const sharedLabel = documentId
    ? sharedIndexEntry?.status === "resolved"
      ? (sharedIndexEntry.title ?? documentId)
      : documentId
    : "未关联文档";
  return Object.entries(displayTypes)
    .filter(([, displayType]) => displayType === "Document")
    .map(([fieldName]) => {
      const key = buildDocumentFieldKey({
        sourceFile: sourcePath,
        sourceCollection: collectionPath,
        fieldPath: [fieldName],
      });
      if (documentFieldConfigs[key]?.enabled !== true) return null;
      return {
        fieldName,
        key,
        documentId,
        label: sharedLabel,
        indexEntry: sharedIndexEntry,
      };
    })
    .filter(Boolean);
}

export function findPreferredActiveDocumentField({
  selectedDocumentFields,
  activeFieldName,
  preferLinkedField = false,
}) {
  const currentField = activeFieldName
    ? selectedDocumentFields.find((entry) => entry.fieldName === activeFieldName) ?? null
    : null;
  if (preferLinkedField) {
    if (currentField?.documentId) return currentField;
    const linkedField = selectedDocumentFields.find((entry) => entry.documentId);
    if (linkedField) return linkedField;
  }
  return currentField ?? selectedDocumentFields[0] ?? null;
}

export function shouldOpenDetailDocumentPanel({
  detailOpen,
  panelPreferenceOpen,
  selectedDocumentFields,
}) {
  return Boolean(
    detailOpen
    && panelPreferenceOpen
    && selectedDocumentFields.some((entry) => entry.documentId),
  );
}

export function mergeDetailFieldOrder(row, displayTypes) {
  const ordered = Object.keys(row ?? {}).filter((fieldName) => fieldName !== "__rowIndex");
  for (const [fieldName, displayType] of Object.entries(displayTypes)) {
    if (displayType !== "Document") continue;
    if (ordered.includes(fieldName)) continue;
    ordered.push(fieldName);
  }
  return ordered;
}
