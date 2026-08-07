import { buildDocumentFieldKey } from "./document-config.mjs";

/**
 * @param {{
 *   sourcePath: string | null;
 *   collectionPath: string;
 *   row: Record<string, unknown> | null | undefined;
 *   primaryKeyField: string | null;
 *   displayTypes: Record<string, import("./fieldTypes").FieldDisplayType>;
 *   documentFieldConfigs: Record<string, { enabled: true }>;
 *   documentRoot?: string | null;
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
  documentRoot = null,
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
      // A configured document field may carry an explicit document reference.
      // When it is blank, use the record primary key so a collection can link
      // one Markdown file per record without duplicating that ID into every row.
      const rawDocumentId = row[fieldName];
      const documentReference = hasDocumentReference(rawDocumentId)
        ? rawDocumentId
        : primaryKeyField
          ? row[primaryKeyField]
          : rawDocumentId;
      const documentId = resolveDocumentId({
        value: documentReference,
        documentRoot,
        documentIndexEntries,
      });
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

function hasDocumentReference(value) {
  return value != null && String(value).trim() !== "";
}

/**
 * Resolves a Document field without imposing a project-specific storage shape.
 * A project may store the document index id, a Markdown filename, or a
 * project-relative path under its configured document root.
 */
export function resolveDocumentId({ value, documentRoot = null, documentIndexEntries = {} }) {
  const raw = value == null ? "" : String(value).trim();
  if (!raw || documentIndexEntries[raw]) return raw;

  const normalized = normalizeDocumentPath(raw);
  if (!normalized) return raw;
  const root = normalizeDocumentPath(documentRoot ?? "");
  const relative = root && normalized.startsWith(`${root}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
  const withoutExtension = relative.replace(/\.md$/i, "");
  if (documentIndexEntries[withoutExtension]) return withoutExtension;

  const matchingEntry = Object.values(documentIndexEntries).find((entry) =>
    normalizeDocumentPath(entry?.relativePath ?? "").replace(/\.md$/i, "") === withoutExtension,
  );
  return matchingEntry?.id ?? raw;
}

function normalizeDocumentPath(value) {
  const normalized = String(value ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/").replace(/\/$/, "");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized) || normalized.split("/").includes("..")) return "";
  return normalized;
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
