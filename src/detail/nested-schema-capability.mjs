import { buildNodeLookupKey, cloneObjectNodeSchema } from "./node-schema.mjs";

/** @typedef {import("./node-schema").ResolveNestedNodeSchemaResult} ResolveNestedNodeSchemaResult */
/** @typedef {import("./node-schema").ResolveNestedNodeSchemaContext & { dataSourceId: string, path: string }} NestedSchemaCapabilityContext */
/** @typedef {{ resolve(context: NestedSchemaCapabilityContext): ResolveNestedNodeSchemaResult }} NestedSchemaCapabilityResolver */

/**
 * Resolves project-owned nested schemas.  The editor only interprets JSON;
 * it never imports project code or infers a business document path.
 */
/** @returns {NestedSchemaCapabilityResolver} */
export function createNestedSchemaCapabilityResolver(loadedBindings = []) {
  const bindings = loadedBindings.map(normalizeBinding);
  return Object.freeze({
    /** @param {NestedSchemaCapabilityContext} context @returns {ResolveNestedNodeSchemaResult} */
    resolve(context) {
      const nestedPath = normalizePath(context.nestedPath);
      const binding = bindings.find((candidate) => sameMatch(candidate.match, {
        dataSourceId: context.dataSourceId,
        path: context.path,
        collection: context.collectionPath,
        rootField: context.rootField,
        nestedPath,
      }));
      if (!binding) return unsupported(context, "No project capability schema matches this nested value.");
      return resolveSchema(context, binding.definition.schema);
    },
  });
}

function normalizeBinding(value) {
  if (!value || typeof value !== "object" || !value.match || !value.definition || typeof value.definition !== "object") {
    throw new TypeError("Nested schema capability binding is invalid.");
  }
  const schema = value.definition.schema;
  if (!isSchema(schema)) throw new TypeError(`Nested schema capability ${String(value.id ?? "<unknown>")} has an invalid schema.`);
  return {
    id: String(value.id ?? ""),
    match: {
      dataSourceId: String(value.match.dataSourceId),
      path: String(value.match.path),
      collection: String(value.match.collection),
      rootField: String(value.match.rootField ?? ""),
      nestedPath: normalizePath(value.match.nestedPath ?? []),
    },
    definition: { schema },
  };
}

/** @returns {ResolveNestedNodeSchemaResult} */
function resolveSchema(context, schema) {
  if (schema.nodeKind === "object") {
    return { kind: "supported", lookupKey: buildNodeLookupKey(context), schema: cloneObjectNodeSchema(schema) };
  }
  const discriminator = readDiscriminator(schema, context.value, context.contextValue);
  const defaultDiscriminator = schema.defaultVariant ?? Object.keys(schema.variants)[0] ?? null;
  const currentDiscriminator = discriminator ?? defaultDiscriminator;
  const variant = currentDiscriminator == null ? null : schema.variants[currentDiscriminator];
  if (!variant) return unsupported(context, `No schema variant for discriminator ${String(discriminator ?? "<null>")}.`);
  return {
    kind: "supported",
    lookupKey: buildNodeLookupKey({ ...context, discriminator: currentDiscriminator }),
    schema: cloneObjectNodeSchema(variant),
    discriminatorField: schema.discriminatorField,
    discriminatorOptions: Object.keys(schema.variants),
    currentDiscriminator,
    defaultDiscriminator,
    canSwitchDiscriminator: !hasDiscriminator(context.contextValue, schema.discriminatorField),
    variantDefaults: Object.fromEntries(Object.entries(schema.variants).map(([key, item]) => [key, structuredClone(item.defaultValue)])),
  };
}

/** @returns {ResolveNestedNodeSchemaResult} */
function unsupported(context, reason) {
  return { kind: "unsupported", lookupKey: buildNodeLookupKey(context), reason };
}

function sameMatch(left, right) {
  return left.dataSourceId === String(right.dataSourceId)
    && left.path === String(right.path)
    && left.collection === String(right.collection)
    && left.rootField === String(right.rootField)
    && left.nestedPath.length === right.nestedPath.length
    && left.nestedPath.every((part, index) => part === right.nestedPath[index]);
}

function normalizePath(value) {
  if (!Array.isArray(value)) throw new TypeError("Nested schema path must be an array.");
  return value.map((part) => typeof part === "number" ? "[]" : String(part));
}

function readDiscriminator(schema, value, contextValue) {
  if (hasDiscriminator(value, schema.discriminatorField)) return String(value[schema.discriminatorField]);
  if (hasDiscriminator(contextValue, schema.discriminatorField)) return String(contextValue[schema.discriminatorField]);
  return null;
}

function hasDiscriminator(value, field) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && field in value;
}

function isSchema(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.nodeKind === "object") return typeof value.title === "string" && Array.isArray(value.fields) && value.defaultValue && typeof value.defaultValue === "object" && !Array.isArray(value.defaultValue);
  return typeof value.discriminatorField === "string" && value.variants && typeof value.variants === "object" && !Array.isArray(value.variants)
    && Object.values(value.variants).every((variant) => variant?.nodeKind === "object" && Array.isArray(variant.fields));
}
