import path from "node:path";

export function resolveEntryActionDocumentTarget({ viewConfig, file, collection, row }) {
  const primaryKeyField = normalizeNonEmptyString(viewConfig?.primaryKeys?.[`${file}:${collection}`]);
  const documentRoot = normalizeDocumentRoot(viewConfig?.documentFiles?.[file]?.docRoot);
  if (!primaryKeyField || !documentRoot) documentTargetNotConfigured();
  const sourceValue = normalizePrimaryKeyValue(row?.[primaryKeyField]);
  if (!sourceValue) documentTargetNotConfigured();
  return Object.freeze({
    primaryKeyField,
    documentRoot,
    sourceValue,
    path: `${documentRoot}/${sourceValue}.md`,
  });
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDocumentRoot(value) {
  const normalized = normalizeNonEmptyString(value)?.replaceAll("\\", "/");
  if (!normalized || path.posix.isAbsolute(normalized) || path.posix.normalize(normalized) !== normalized || normalized === "." || normalized.startsWith("../")) return null;
  return normalized.replace(/\/+$/, "");
}

function normalizePrimaryKeyValue(value) {
  const normalized = typeof value === "string" ? value.trim() : Number.isSafeInteger(value) ? String(value) : null;
  return normalized && /^[a-zA-Z0-9_-]+$/.test(normalized) ? normalized : null;
}

function documentTargetNotConfigured() {
  throw Object.assign(new Error("The target collection must configure both a primary key and document root before Markdown automation can run."), {
    code: "ENTRY_ACTION_DOCUMENT_TARGET_NOT_CONFIGURED",
  });
}
