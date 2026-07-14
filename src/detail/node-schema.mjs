export function cloneSchemaValue(value) {
  if (Array.isArray(value)) return value.map((item) => cloneSchemaValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneSchemaValue(item)]));
  }
  return value;
}

export function cloneNodeFieldSchema(field) {
  const clone = {
    ...field,
    defaultValue: cloneSchemaValue(field.defaultValue),
  };
  if (field.options) clone.options = field.options.map((option) => ({ ...option }));
  if (Object.hasOwn(field, "visibleWhen")) clone.visibleWhen = cloneSchemaValue(field.visibleWhen);
  if (Object.hasOwn(field, "disabledWhen")) clone.disabledWhen = cloneSchemaValue(field.disabledWhen);
  if (Object.hasOwn(field, "arrayItem")) clone.arrayItem = cloneSchemaValue(field.arrayItem);
  if (field.nestedSchema) clone.nestedSchema = cloneNestedNodeSchema(field.nestedSchema);
  return clone;
}

export function cloneObjectNodeSchema(schema) {
  const clone = {
    ...schema,
    fields: schema.fields.map((field) => cloneNodeFieldSchema(field)),
    defaultValue: cloneSchemaValue(schema.defaultValue),
    presentation: schema.presentation ? {
      ...schema.presentation,
      sections: Array.isArray(schema.presentation.sections)
        ? schema.presentation.sections.map((section) => ({
          ...section,
          fieldNames: Array.isArray(section.fieldNames) ? [...section.fieldNames] : [],
        }))
        : undefined,
      advancedFields: Array.isArray(schema.presentation.advancedFields)
        ? [...schema.presentation.advancedFields]
        : undefined,
      summaryFields: Array.isArray(schema.presentation.summaryFields)
        ? [...schema.presentation.summaryFields]
        : undefined,
    } : null,
  };
  if (Object.hasOwn(schema, "constraints")) clone.constraints = cloneSchemaValue(schema.constraints);
  return clone;
}

export function createObjectNodeSchema({
  title,
  fields,
  defaultValue,
  allowUnknownFields = false,
  presentation = null,
  constraints = [],
  omitDefaults = false,
}) {
  return {
    nodeKind: "object",
    title,
    fields,
    defaultValue,
    allowUnknownFields,
    presentation,
    ...(constraints.length ? { constraints } : {}),
    ...(omitDefaults ? { omitDefaults: true } : {}),
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

function cloneNestedNodeSchema(schema) {
  if (schema.nodeKind === "object") return cloneObjectNodeSchema(schema);
  return {
    ...schema,
    variants: Object.fromEntries(
      Object.entries(schema.variants).map(([key, variant]) => [key, cloneObjectNodeSchema(variant)]),
    ),
  };
}
