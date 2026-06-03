import { buildRelationKey } from "./relation-path.mjs";

export function resolveRelationField({ sourceFile, sourceCollection, fieldPath, value, viewConfig, relationOptions = {}, relationIndexes = {} }) {
  const relationKey = buildRelationKey({ sourceFile, sourceCollection, fieldPath });
  const config = viewConfig?.relations?.[relationKey];
  if (!config) return { kind: "none" };
  if (!isRelationValueCompatible(config.mode, value)) {
    return { kind: "incompatible", relationKey, expectedMode: config.mode };
  }
  return {
    kind: "configured",
    relationKey,
    config,
    options: relationOptions[relationKey] ?? [],
    missingValues: collectMissingValues(value, config.mode, relationIndexes[relationKey]),
  };
}

export function isRelationValueCompatible(mode, value) {
  if (mode === "multi") {
    return Array.isArray(value) && value.every((item) => item == null || typeof item === "string" || typeof item === "number");
  }
  return value == null || value === "" || typeof value === "string" || typeof value === "number";
}

function collectMissingValues(value, mode, index) {
  if (!index) return [];
  const values = mode === "multi" ? value : [value];
  return values
    .filter((item) => item != null && item !== "")
    .map((item) => String(item))
    .filter((item) => !index.has(item));
}
