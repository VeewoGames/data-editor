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
  return Object.entries(displayTypes)
    .filter(([, displayType]) => displayType === "Document")
    .map(([fieldName]) => {
      const key = buildDocumentFieldKey({
        sourceFile: sourcePath,
        sourceCollection: collectionPath,
        fieldPath: [fieldName],
      });
      if (documentFieldConfigs[key]?.enabled !== true) return null;
      const rawDocumentId = row[fieldName];
      const documentId = rawDocumentId == null ? "" : String(rawDocumentId).trim();
      const indexEntry = documentId ? documentIndexEntries[documentId] ?? null : null;
      const label = documentId
        ? indexEntry?.status === "resolved"
          ? (indexEntry.title ?? documentId)
          : documentId
        : "未关联文档";
      return {
        fieldName,
        key,
        documentId,
        label,
        indexEntry,
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

export function mergeDetailFieldOrder(row, knownFields = [], displayTypes = {}) {
  const ordered = [];
  const seen = new Set();

  for (const fieldName of Object.keys(row ?? {})) {
    if (fieldName === "__rowIndex" || seen.has(fieldName)) continue;
    seen.add(fieldName);
    ordered.push(fieldName);
  }

  for (const fieldName of knownFields) {
    if (!fieldName || fieldName === "__rowIndex" || seen.has(fieldName)) continue;
    seen.add(fieldName);
    ordered.push(fieldName);
  }

  for (const fieldName of Object.keys(displayTypes)) {
    if (fieldName === "__rowIndex" || seen.has(fieldName)) continue;
    seen.add(fieldName);
    ordered.push(fieldName);
  }

  return ordered;
}
