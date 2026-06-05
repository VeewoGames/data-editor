import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProjectContext, displayProjectPath, resolveInsideRoot } from "./project-context.mjs";
import {
  currentRelationsVersion,
  defaultBacklinkConfigs,
  defaultPrimaryKeys,
  defaultRelationConfigs,
  defaultTitleFields,
} from "./relation-defaults.mjs";
import { syncBacklinksWithRelations } from "./model/field-role.mjs";

export { defaultRelationConfigs };

export async function loadViewConfig(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  const target = resolveInsideRoot(context.projectRoot, context.sharedViewConfigPath);
  try {
    const parsed = JSON.parse(await readFile(target, "utf8"));
    return normalizeViewConfig(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return loadLegacyViewConfig(context);
    throw error;
  }
}

export async function saveViewConfig(projectContextOrRoot, config) {
  const context = createProjectContext(projectContextOrRoot);
  const target = resolveInsideRoot(context.projectRoot, context.sharedViewConfigPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(normalizeViewConfig(config), null, 2)}\n`, "utf8");
  return { path: displayProjectPath(context, target) };
}

async function loadLegacyViewConfig(context) {
  if (!context.legacySharedViewConfigPath) return emptyViewConfig();
  const legacyTarget = resolveInsideRoot(context.projectRoot, context.legacySharedViewConfigPath);
  try {
    const parsed = JSON.parse(await readFile(legacyTarget, "utf8"));
    return normalizeViewConfig(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return emptyViewConfig();
    throw error;
  }
}

export function emptyViewConfig() {
  return {
    fields: {},
    primaryKeys: defaultPrimaryKeys(),
    backlinks: defaultBacklinkConfigs(),
    relations: defaultRelationConfigs(),
    relationsVersion: currentRelationsVersion,
  };
}

function normalizeViewConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyViewConfig();
  const fields = value.fields;
  const normalizedFields = {};
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    for (const [fieldKey, fieldConfig] of Object.entries(fields)) {
      if (!fieldConfig || typeof fieldConfig !== "object" || Array.isArray(fieldConfig)) continue;
      const multiSelectOptionMap = fieldConfig.multiSelectOptions;
      const selectOptionMap = fieldConfig.selectOptions;
      const normalizedOptions = {};
      if (multiSelectOptionMap && typeof multiSelectOptionMap === "object" && !Array.isArray(multiSelectOptionMap)) {
        for (const [optionValue, optionConfig] of Object.entries(multiSelectOptionMap)) {
          if (!optionConfig || typeof optionConfig !== "object" || Array.isArray(optionConfig)) continue;
          normalizedOptions[optionValue] = {
            label: typeof optionConfig.label === "string" && optionConfig.label.trim() ? optionConfig.label : optionValue,
            color: typeof optionConfig.color === "string" && optionConfig.color.trim() ? optionConfig.color : null,
          };
        }
      }
      const normalizedSelectOptions = {};
      if (selectOptionMap && typeof selectOptionMap === "object" && !Array.isArray(selectOptionMap)) {
        for (const [optionValue, optionConfig] of Object.entries(selectOptionMap)) {
          if (!optionConfig || typeof optionConfig !== "object" || Array.isArray(optionConfig)) continue;
          normalizedSelectOptions[optionValue] = {
            label: typeof optionConfig.label === "string" && optionConfig.label.trim() ? optionConfig.label : optionValue,
            color: typeof optionConfig.color === "string" && optionConfig.color.trim() ? optionConfig.color : null,
          };
        }
      }
      normalizedFields[fieldKey] = {
        type: fieldConfig.type === "Select" || fieldConfig.type === "Text" ? fieldConfig.type : undefined,
        selectOptions: normalizedSelectOptions,
        multiSelectOptions: normalizedOptions,
      };
    }
  }

  const normalized = {
    fields: normalizedFields,
    primaryKeys: normalizePrimaryKeys(value.primaryKeys),
    backlinks: normalizeBacklinks(value.backlinks),
    relations: normalizeRelations(value.relations),
    relationsVersion: Number.isInteger(value.relationsVersion) ? value.relationsVersion : 0,
  };
  if (normalized.relationsVersion < currentRelationsVersion) {
    normalized.primaryKeys = { ...defaultPrimaryKeys(), ...normalized.primaryKeys };
    normalized.backlinks = { ...defaultBacklinkConfigs(), ...normalized.backlinks };
    normalized.relations = { ...defaultRelationConfigs(), ...normalized.relations };
    normalized.relationsVersion = currentRelationsVersion;
  }
  normalized.relations = filterInvalidPrimaryKeySelfRelations(normalized.relations, normalized.primaryKeys);
  normalized.backlinks = syncBacklinksWithRelations(normalized.relations, normalized.backlinks);
  return normalized;
}

function normalizePrimaryKeys(value) {
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
    const next = normalizeRelationConfig(relationConfig);
    if (next) normalized[relationKey] = next;
  }
  return normalized;
}

function normalizeBacklinks(value) {
  const normalized = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalized;
  for (const [backlinkKey, backlinkConfig] of Object.entries(value)) {
    const next = normalizeBacklinkConfig(backlinkConfig);
    if (next) normalized[backlinkKey] = next;
  }
  return normalized;
}

function normalizeRelationConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const targetFile = normalizeNonEmptyString(value.targetFile);
  const targetCollection = normalizeNonEmptyString(value.targetCollection);
  const targetKey = normalizeNonEmptyString(value.targetKey);
  if (!targetFile || !targetCollection || !targetKey || (value.mode !== "single" && value.mode !== "multi")) return null;
  const titleFields = Array.isArray(value.titleFields)
    ? value.titleFields.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
  return {
    targetFile,
    targetCollection,
    targetKey,
    mode: value.mode,
    titleFields: titleFields.length ? [...new Set(titleFields)] : defaultTitleFields,
    allowMissing: value.allowMissing === true,
  };
}

function normalizeBacklinkConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sourceRelation = normalizeNonEmptyString(value.sourceRelation);
  if (!sourceRelation) return null;
  return {
    sourceRelation,
    displayMode: value.displayMode === "list" ? "list" : "list",
  };
}

function filterInvalidPrimaryKeySelfRelations(relations, primaryKeys) {
  const filtered = {};
  for (const [relationKey, relationConfig] of Object.entries(relations ?? {})) {
    if (isInvalidPrimaryKeySelfRelation(relationKey, relationConfig, primaryKeys)) continue;
    filtered[relationKey] = relationConfig;
  }
  return filtered;
}

function isInvalidPrimaryKeySelfRelation(relationKey, relationConfig, primaryKeys) {
  const parsed = parseRelationKey(relationKey);
  if (!parsed) return false;
  const primaryKey = primaryKeys?.[`${parsed.sourceFile}:${parsed.sourceCollection}`];
  if (!primaryKey) return false;
  if (parsed.sourceFile !== relationConfig.targetFile) return false;
  if (parsed.sourceCollection !== relationConfig.targetCollection) return false;
  if (relationConfig.targetKey !== primaryKey) return false;
  return parsed.fieldPath === primaryKey;
}

function parseRelationKey(relationKey) {
  const parts = String(relationKey).split(":");
  if (parts.length < 3) return null;
  const [sourceFile, sourceCollection, ...fieldPathParts] = parts;
  const fieldPath = fieldPathParts.join(":").trim();
  if (!sourceFile || !sourceCollection || !fieldPath) return null;
  return { sourceFile, sourceCollection, fieldPath };
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
