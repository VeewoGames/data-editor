export default function normalizeFetchedViewConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyViewConfig();
  const source = value;
  return {
    fields: normalizeFields(source.fields),
    titleFields: normalizeCollectionFields(source.titleFields),
    documentFiles: normalizeDocumentFiles(source.documentFiles),
    documentFields: normalizeDocumentFields(source.documentFields),
    primaryKeys: normalizeCollectionFields(source.primaryKeys),
    backlinks: normalizeBacklinks(source.backlinks),
    relations: filterDocumentFieldRelations(normalizeRelations(source.relations), normalizeDocumentFields(source.documentFields)),
    relationsVersion: Number.isInteger(source.relationsVersion) ? source.relationsVersion : 0,
  };
}

function emptyViewConfig() {
  return {
    fields: {},
    titleFields: {},
    documentFiles: {},
    documentFields: {},
    primaryKeys: {},
    backlinks: {},
    relations: {},
    relationsVersion: 0,
  };
}

function normalizeFields(value) {
  const normalizedFields = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalizedFields;
  for (const [fieldKey, fieldConfig] of Object.entries(value)) {
    if (!fieldConfig || typeof fieldConfig !== "object" || Array.isArray(fieldConfig)) continue;
    const normalizedSelectOptions = normalizeOptionMap(fieldConfig.selectOptions);
    const normalizedMultiSelectOptions = normalizeOptionMap(fieldConfig.multiSelectOptions);
    normalizedFields[fieldKey] = {
      type: fieldConfig.type === "Select" || fieldConfig.type === "Text" || fieldConfig.type === "Document" ? fieldConfig.type : undefined,
      selectOptions: normalizedSelectOptions,
      multiSelectOptions: normalizedMultiSelectOptions,
    };
  }
  return normalizedFields;
}

function normalizeOptionMap(value) {
  const normalized = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalized;
  for (const [optionValue, optionConfig] of Object.entries(value)) {
    if (!optionConfig || typeof optionConfig !== "object" || Array.isArray(optionConfig)) continue;
    normalized[optionValue] = {
      label: typeof optionConfig.label === "string" && optionConfig.label.trim() ? optionConfig.label : optionValue,
      color: typeof optionConfig.color === "string" && optionConfig.color.trim() ? optionConfig.color : null,
    };
  }
  return normalized;
}

function normalizeDocumentFiles(value) {
  const normalized = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalized;
  for (const [filePath, config] of Object.entries(value)) {
    const nextFilePath = normalizeNonEmptyString(filePath);
    const docRoot = normalizeNonEmptyString(config?.docRoot);
    if (!nextFilePath || !docRoot) continue;
    normalized[nextFilePath] = { docRoot };
  }
  return normalized;
}

function normalizeDocumentFields(value) {
  const normalized = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalized;
  for (const [fieldKey, config] of Object.entries(value)) {
    const nextFieldKey = normalizeNonEmptyString(fieldKey);
    if (!nextFieldKey || config?.enabled !== true) continue;
    normalized[nextFieldKey] = { enabled: true };
  }
  return normalized;
}

function normalizeCollectionFields(value) {
  const normalized = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalized;
  for (const [collectionKey, fieldName] of Object.entries(value)) {
    const nextCollectionKey = normalizeNonEmptyString(collectionKey);
    const nextFieldName = normalizeNonEmptyString(fieldName);
    if (!nextCollectionKey || !nextFieldName) continue;
    normalized[nextCollectionKey] = nextFieldName;
  }
  return normalized;
}

function normalizeRelations(value) {
  const normalized = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalized;
  for (const [relationKey, relationConfig] of Object.entries(value)) {
    if (!relationConfig || typeof relationConfig !== "object" || Array.isArray(relationConfig)) continue;
    const targetFile = normalizeNonEmptyString(relationConfig.targetFile);
    const targetCollection = normalizeNonEmptyString(relationConfig.targetCollection);
    const targetKey = normalizeNonEmptyString(relationConfig.targetKey);
    if (!targetFile || !targetCollection || !targetKey || (relationConfig.mode !== "single" && relationConfig.mode !== "multi")) continue;
    normalized[relationKey] = {
      targetFile,
      targetCollection,
      targetKey,
      mode: relationConfig.mode,
      titleFields: Array.isArray(relationConfig.titleFields)
        ? relationConfig.titleFields.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
        : [],
      allowMissing: relationConfig.allowMissing === true,
    };
  }
  return normalized;
}

function normalizeBacklinks(value) {
  const normalized = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalized;
  for (const [backlinkKey, backlinkConfig] of Object.entries(value)) {
    if (!backlinkConfig || typeof backlinkConfig !== "object" || Array.isArray(backlinkConfig)) continue;
    const sourceRelation = normalizeNonEmptyString(backlinkConfig.sourceRelation);
    if (!sourceRelation) continue;
    normalized[backlinkKey] = {
      sourceRelation,
      displayMode: backlinkConfig.displayMode === "list" ? "list" : "list",
    };
  }
  return normalized;
}

function filterDocumentFieldRelations(relations, documentFields) {
  const filtered = {};
  const documentFieldKeys = new Set(Object.keys(documentFields ?? {}));
  for (const [relationKey, relationConfig] of Object.entries(relations ?? {})) {
    if (documentFieldKeys.has(relationKey)) continue;
    filtered[relationKey] = relationConfig;
  }
  return filtered;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
