import Ajv2020 from "ajv/dist/2020.js";

const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const COMMON = new Set(["type", "nullable", "enum", "const"]);
const BY_TYPE = {
  object: new Set(["properties", "required", "additionalProperties", "allOf"]),
  array: new Set(["items", "minItems", "maxItems", "uniqueItems"]),
  string: new Set(["minLength", "maxLength", "pattern"]),
  number: new Set(["minimum", "maximum"]), integer: new Set(["minimum", "maximum"]),
  boolean: new Set(), null: new Set(),
};

export function validateCandidateRowSchema(schema) {
  inspect(schema, "$", true);
  try { createAjv().compile(schema); }
  catch (cause) { fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { cause: String(cause?.message ?? cause) }); }
  return structuredClone(schema);
}

export function assertCandidateRowSchema(schema, value) {
  validateCandidateRowSchema(schema);
  const validate = createAjv().compile(schema);
  if (!validate(value)) fail("CANDIDATE_CREATE_SCHEMA_INVALID", { errors: structuredClone(validate.errors ?? []) });
}

function inspect(schema, path, root = false) {
  if (!plain(schema) || typeof schema.type !== "string" || !TYPES.has(schema.type)) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
  const allowed = new Set([...COMMON, ...BY_TYPE[schema.type]]);
  for (const key of Object.keys(schema)) if (!allowed.has(key)) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path, keyword: key });
  if (schema.nullable !== undefined && typeof schema.nullable !== "boolean") fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0 || new Set(schema.enum.map(stable)).size !== schema.enum.length)) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
  if (schema.type === "object") {
    if (!plain(schema.properties) || schema.additionalProperties !== false) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
    if (schema.required !== undefined && (!Array.isArray(schema.required) || new Set(schema.required).size !== schema.required.length || schema.required.some((key) => typeof key !== "string" || !Object.hasOwn(schema.properties, key)))) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
    for (const [key, child] of Object.entries(schema.properties)) { if (!key) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path }); inspect(child, `${path}.properties.${key}`); }
    if (schema.allOf !== undefined) inspectConditionalRequirements(schema.allOf, schema.properties, `${path}.allOf`);
  }
  if (schema.type === "array") {
    if (!schema.items) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path }); inspect(schema.items, `${path}.items`);
    boundedInteger(schema.minItems, 0, `${path}.minItems`); boundedInteger(schema.maxItems, 0, `${path}.maxItems`);
    if (schema.minItems != null && schema.maxItems != null && schema.minItems > schema.maxItems) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
    if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== "boolean") fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
  }
  if (schema.type === "string") {
    boundedInteger(schema.minLength, 0, `${path}.minLength`); boundedInteger(schema.maxLength, 0, `${path}.maxLength`);
    if (schema.minLength != null && schema.maxLength != null && schema.minLength > schema.maxLength) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
    if (schema.pattern !== undefined) { if (typeof schema.pattern !== "string") fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path }); try { new RegExp(schema.pattern, "u"); } catch { fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path }); } }
  }
  if (schema.type === "number" || schema.type === "integer") {
    for (const key of ["minimum", "maximum"]) if (schema[key] !== undefined && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
    if (schema.minimum != null && schema.maximum != null && schema.minimum > schema.maximum) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
  }
  if (root && schema.type !== "object") fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
}

function inspectConditionalRequirements(rules, properties, path) {
  if (!Array.isArray(rules) || rules.length === 0) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
  for (const [index, rule] of rules.entries()) {
    const rulePath = `${path}[${index}]`;
    exactKeys(rule, ["if", "then"], rulePath);
    exactKeys(rule.if, ["properties", "required"], `${rulePath}.if`);
    exactKeys(rule.then, ["required"], `${rulePath}.then`);
    if (!plain(rule.if.properties) || Object.keys(rule.if.properties).length === 0) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path: rulePath });
    fieldList(rule.if.required, properties, `${rulePath}.if.required`);
    fieldList(rule.then.required, properties, `${rulePath}.then.required`);
    const selectors = Object.keys(rule.if.properties);
    if (selectors.length !== rule.if.required.length || selectors.some((key) => !rule.if.required.includes(key))) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path: rulePath });
    for (const [field, matcher] of Object.entries(rule.if.properties)) {
      const matcherPath = `${rulePath}.if.properties.${field}`;
      if (!Object.hasOwn(properties, field) || !plain(matcher) || Object.keys(matcher).length !== 1
          || (!Object.hasOwn(matcher, "const") && !Object.hasOwn(matcher, "enum"))) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path: matcherPath });
      const values = Object.hasOwn(matcher, "const") ? [matcher.const] : matcher.enum;
      if (!Array.isArray(values) || values.length === 0 || values.some((value) => !jsonValue(value))
          || new Set(values.map(stable)).size !== values.length) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path: matcherPath });
      try {
        const validate = createAjv().compile(properties[field]);
        if (values.some((value) => !validate(value))) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path: matcherPath });
      } catch (cause) {
        fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path: matcherPath, cause: String(cause?.message ?? cause) });
      }
    }
  }
}

function exactKeys(value, keys, path) {
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
}
function fieldList(fields, properties, path) {
  if (!Array.isArray(fields) || fields.length === 0 || new Set(fields).size !== fields.length
      || fields.some((field) => typeof field !== "string" || !Object.hasOwn(properties, field))) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path });
}
function jsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return plain(value) && Object.values(value).every(jsonValue);
}
function createAjv() {
  // The restricted grammar checks every required-field reference against its
  // containing object. Ajv strictRequired cannot resolve parent properties in then.
  return new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
}

function boundedInteger(value, minimum, path) { if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) fail("CANDIDATE_CREATE_SCHEMA_DEFINITION_INVALID", { path }); }
function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function fail(code, details) { throw Object.assign(new Error(code), { code, details }); }
