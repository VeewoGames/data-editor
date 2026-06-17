export function buildDocumentFieldKey({ sourceFile, sourceCollection, fieldPath }) {
  const normalizedFieldPath = Array.isArray(fieldPath) ? fieldPath.filter(Boolean).join(".") : String(fieldPath ?? "").trim();
  return `${sourceFile}:${sourceCollection}:${normalizedFieldPath}`;
}

export function getDocumentFieldConfig(viewConfig, sourceFile, sourceCollection, fieldPath) {
  const key = buildDocumentFieldKey({ sourceFile, sourceCollection, fieldPath });
  const config = viewConfig?.documentFields?.[key];
  return config?.enabled === true ? { key, config } : null;
}

export function listDocumentFieldsForCollection(viewConfig, sourceFile, sourceCollection) {
  return Object.entries(viewConfig?.documentFields ?? {})
    .filter(([, config]) => config?.enabled === true)
    .map(([key, config]) => ({ key, config, parsed: parseDocumentFieldKey(key) }))
    .filter((entry) => entry.parsed && entry.parsed.sourceFile === sourceFile && entry.parsed.sourceCollection === sourceCollection)
    .map((entry) => ({
      key: entry.key,
      config: entry.config,
      fieldPath: entry.parsed.fieldPath,
    }));
}

export function parseDocumentFieldKey(key) {
  const parts = String(key).split(":");
  if (parts.length < 3) return null;
  const [sourceFile, sourceCollection, ...fieldPathParts] = parts;
  const fieldPath = fieldPathParts.join(":").split(".").filter(Boolean);
  if (!sourceFile || !sourceCollection || !fieldPath.length) return null;
  return { sourceFile, sourceCollection, fieldPath };
}
