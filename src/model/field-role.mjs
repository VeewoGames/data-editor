export function getPrimaryKeyField(viewConfig, sourceFile, sourceCollection) {
  return viewConfig?.primaryKeys?.[`${sourceFile}:${sourceCollection}`] ?? null;
}

export function buildBacklinkFieldName(relationFieldName) {
  return `back_${String(relationFieldName)}`;
}

export function deriveBacklinkConfigs(viewConfig) {
  return syncBacklinksWithRelations(viewConfig?.relations ?? {}, viewConfig?.backlinks ?? {});
}

export function syncBacklinksWithRelations(relations, existingBacklinks = {}) {
  const synced = {};
  const usedKeys = new Set();
  const existingBySourceRelation = new Map(
    Object.entries(existingBacklinks ?? {})
      .filter(([, config]) => config?.sourceRelation)
      .map(([backlinkKey, config]) => [config.sourceRelation, { backlinkKey, config }]),
  );

  for (const [relationKey, relationConfig] of Object.entries(relations ?? {})) {
    const existing = existingBySourceRelation.get(relationKey);
    const preferredKey = existing?.backlinkKey && isBacklinkKeyCompatible(existing.backlinkKey, relationConfig)
      ? existing.backlinkKey
      : buildBacklinkKey(relationKey, relationConfig);
    const backlinkKey = ensureUniqueBacklinkKey(preferredKey, usedKeys);
    usedKeys.add(backlinkKey);
    synced[backlinkKey] = {
      sourceRelation: relationKey,
      displayMode: existing?.config?.displayMode === "list" ? "list" : "list",
    };
  }

  return synced;
}

export function resolveFieldRole({ sourceFile, sourceCollection, fieldName, viewConfig }) {
  const primaryKey = getPrimaryKeyField(viewConfig, sourceFile, sourceCollection);
  if (primaryKey === fieldName) {
    return { kind: "primaryKey", primaryKey };
  }
  const backlinkKey = `${sourceFile}:${sourceCollection}:${fieldName}`;
  const backlinkConfig = deriveBacklinkConfigs(viewConfig)[backlinkKey];
  if (backlinkConfig) {
    return {
      kind: "backlink",
      backlinkKey,
      config: backlinkConfig,
    };
  }
  const relationKey = `${sourceFile}:${sourceCollection}:${fieldName}`;
  const relationConfig = viewConfig?.relations?.[relationKey];
  if (relationConfig) {
    return {
      kind: "relation",
      relationKey,
      config: relationConfig,
    };
  }
  return { kind: "normal" };
}

function parseRelationKey(relationKey) {
  const parts = String(relationKey).split(":");
  if (parts.length < 3) return null;
  const [sourceFile, sourceCollection, ...fieldPathParts] = parts;
  const fieldPath = fieldPathParts.join(":").split(".").filter(Boolean);
  if (!sourceFile || !sourceCollection || !fieldPath.length) return null;
  return { sourceFile, sourceCollection, fieldPath };
}

function buildBacklinkKey(relationKey, relationConfig) {
  const parsed = parseRelationKey(relationKey);
  if (!parsed) return "";
  const backlinkFieldName = buildBacklinkFieldName(parsed.fieldPath.at(-1));
  return `${relationConfig.targetFile}:${relationConfig.targetCollection}:${backlinkFieldName}`;
}

function isBacklinkKeyCompatible(backlinkKey, relationConfig) {
  const parts = String(backlinkKey).split(":");
  if (parts.length < 3) return false;
  const [file, collection] = parts;
  return file === relationConfig.targetFile && collection === relationConfig.targetCollection;
}

function ensureUniqueBacklinkKey(backlinkKey, usedKeys) {
  if (!backlinkKey) return backlinkKey;
  if (!usedKeys.has(backlinkKey)) return backlinkKey;
  const parts = String(backlinkKey).split(":");
  if (parts.length < 3) return backlinkKey;
  const [file, collection, ...fieldParts] = parts;
  const fieldName = fieldParts.join(":");
  let suffix = 2;
  while (usedKeys.has(`${file}:${collection}:${fieldName}_${suffix}`)) suffix += 1;
  return `${file}:${collection}:${fieldName}_${suffix}`;
}
