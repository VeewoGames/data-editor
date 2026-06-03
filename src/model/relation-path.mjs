export function normalizeFieldPath(fieldPath) {
  return fieldPath.map((part) => typeof part === "number" ? "*" : String(part)).join(".");
}

export function buildRelationKey({ sourceFile, sourceCollection, fieldPath }) {
  return `${sourceFile}:${sourceCollection}:${normalizeFieldPath(fieldPath)}`;
}

export function matchRelationKey(configKey, input) {
  return configKey === buildRelationKey(input);
}
