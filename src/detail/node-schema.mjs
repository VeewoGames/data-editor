export function cloneSchemaValue(value) {
  if (Array.isArray(value)) return value.map((item) => cloneSchemaValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneSchemaValue(item)]));
  }
  return value;
}

export function createObjectNodeSchema({ title, fields, defaultValue, allowUnknownFields = false, presentation = null }) {
  return {
    nodeKind: "object",
    title,
    fields,
    defaultValue,
    allowUnknownFields,
    presentation,
  };
}

export function createDiscriminatedObjectNodeSchema({ discriminatorField, variants, defaultVariant = null }) {
  return {
    discriminatorField,
    variants,
    defaultVariant,
  };
}

export function buildNodeLookupKey({ sourcePath, collectionPath, rootField, nestedPath, discriminator = null }) {
  const normalizedSourcePath = sourcePath ?? "<unknown>";
  const normalizedCollectionPath = collectionPath ?? "<unknown>";
  const normalizedPath = nestedPath.length
    ? nestedPath.map((segment) => (typeof segment === "number" ? "[]" : String(segment))).join(".")
    : "<root>";
  const discriminatorPart = discriminator == null ? "" : `#${String(discriminator)}`;
  return `${normalizedSourcePath}::${normalizedCollectionPath}::${rootField}::${normalizedPath}${discriminatorPart}`;
}
