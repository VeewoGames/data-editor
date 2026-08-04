import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { createProjectContext, resolveInsideRoot } from "./project-context.mjs";

export const capabilityApiVersion = 1;
export const enrollmentRelativePath = ".data-editor/enrollment.json";
export const capabilityManifestRelativePath = ".data-editor/project.json";

const supportedEngines = new Set(["nested-schema-v1", "document-contract-v1", "identity-policy-v1"]);

export class ProjectCapabilityManifestError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "ProjectCapabilityManifestError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Loads only project-owned declarative capability data. It never evaluates a
 * project module, script, command, or skill name.
 */
export async function loadProjectCapabilityManifest(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  const enrollmentPath = resolveInsideRoot(context.projectRoot, enrollmentRelativePath);
  const manifestPath = resolveInsideRoot(context.projectRoot, capabilityManifestRelativePath);
  const [enrollmentResult, manifestResult] = await Promise.all([
    readOptionalJson(enrollmentPath, "CAPABILITY_ENROLLMENT_INVALID_JSON"),
    readOptionalJson(manifestPath, "CAPABILITY_MANIFEST_INVALID_JSON"),
  ]);

  if (!enrollmentResult.exists && !manifestResult.exists) {
    return genericAbsent(context);
  }
  if (!enrollmentResult.exists) {
    return invalid(context, "CAPABILITY_ENROLLMENT_MISSING", "Capability manifest exists without enrollment.");
  }
  if (!manifestResult.exists) {
    return invalid(context, "CAPABILITY_MANIFEST_MISSING", "Enrolled project is missing its capability manifest.");
  }
  if (enrollmentResult.error) return invalid(context, enrollmentResult.error.code, enrollmentResult.error.message);
  if (manifestResult.error) return invalid(context, manifestResult.error.code, manifestResult.error.message);

  try {
    validateEnrollment(enrollmentResult.value);
    const manifest = normalizeManifest(manifestResult.value, context);
    return {
      status: "active",
      projectId: context.projectId,
      enrollment: enrollmentResult.value,
      manifest,
      manifestDigest: digest(manifest),
      enrollmentPath,
      manifestPath,
    };
  } catch (error) {
    if (error instanceof ProjectCapabilityManifestError) return invalid(context, error.code, error.message, error.details);
    throw error;
  }
}

export function normalizeManifest(value, projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectCapabilityManifestError("CAPABILITY_MANIFEST_INVALID", "Capability manifest must be an object.");
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(manifestSchema);
  if (!validate(value)) {
    throw new ProjectCapabilityManifestError("CAPABILITY_MANIFEST_SCHEMA_INVALID", "Capability manifest does not match the capability grammar.", validate.errors ?? []);
  }
  if (value.version !== 1 || value.requires.capabilityApi !== capabilityApiVersion) {
    throw new ProjectCapabilityManifestError("CAPABILITY_API_UNSUPPORTED", "Capability manifest requires an unsupported capability API.");
  }

  const capabilities = {
    nestedSchemas: normalizeBindings(value.capabilities.nestedSchemas ?? [], context, "nested-schema-v1", normalizeNestedSchema),
    documentContracts: normalizeBindings(value.capabilities.documentContracts ?? [], context, "document-contract-v1", normalizeDocumentContract),
    identityPolicies: normalizeBindings(value.capabilities.identityPolicies ?? [], context, "identity-policy-v1", normalizeIdentityPolicy),
  };
  const ids = Object.values(capabilities).flat().map((binding) => binding.id);
  if (new Set(ids).size !== ids.length) {
    throw new ProjectCapabilityManifestError("CAPABILITY_BINDING_DUPLICATE", "Capability binding ids must be unique across engines.");
  }
  return {
    version: 1,
    requires: { capabilityApi: capabilityApiVersion },
    capabilities,
    ...(value.transition ? { transition: normalizeTransition(value.transition) } : {}),
  };
}

export function capabilityManifestDigest(manifest) {
  return digest(manifest);
}

function validateEnrollment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.version !== 1
    || value.requires?.capabilityApi !== capabilityApiVersion
    || Object.keys(value).some((key) => key !== "version" && key !== "requires")
    || Object.keys(value.requires ?? {}).some((key) => key !== "capabilityApi")) {
    throw new ProjectCapabilityManifestError("CAPABILITY_ENROLLMENT_INVALID", "Enrollment must require capability API version 1 only.");
  }
}

function normalizeBindings(bindings, context, engine, normalize) {
  const ids = new Set();
  return bindings.map((binding) => {
    if (binding.engine !== engine || !supportedEngines.has(binding.engine)) {
      throw new ProjectCapabilityManifestError("CAPABILITY_ENGINE_INVALID", `Unsupported capability engine: ${String(binding.engine)}.`);
    }
    if (ids.has(binding.id)) throw new ProjectCapabilityManifestError("CAPABILITY_BINDING_DUPLICATE", `Duplicate ${engine} binding id: ${binding.id}.`);
    ids.add(binding.id);
    return normalize(binding, context);
  });
}

function normalizeNestedSchema(binding, context) {
  return {
    id: binding.id,
    engine: binding.engine,
    match: normalizeMatch(binding.match, context),
    manifest: normalizeResourcePath(binding.manifest, context),
  };
}

function normalizeDocumentContract(binding, context) {
  return {
    id: binding.id,
    engine: binding.engine,
    match: normalizeMatch(binding.match, context),
    contract: normalizeResourcePath(binding.contract, context),
    contractSchema: normalizeResourcePath(binding.contractSchema, context),
  };
}

function normalizeIdentityPolicy(binding, context) {
  const protectedIdentityFields = [...new Set(binding.protectedIdentityFields ?? [])];
  if (binding.provider?.kind === "embedded-v1" && !binding.provider.field) {
    throw new ProjectCapabilityManifestError("CAPABILITY_IDENTITY_FIELD_REQUIRED", "embedded-v1 requires an explicit durable identity field.");
  }
  if (binding.provider?.kind === "declared-key-v1" && !protectedIdentityFields.length) {
    throw new ProjectCapabilityManifestError("CAPABILITY_IDENTITY_FIELDS_REQUIRED", "declared-key-v1 requires protectedIdentityFields.");
  }
  return {
    id: binding.id,
    engine: binding.engine,
    match: normalizeMatch(binding.match, context),
    provider: { kind: binding.provider.kind, ...(binding.provider.field ? { field: binding.provider.field } : {}) },
    protectedIdentityFields,
  };
}

function normalizeMatch(match, context) {
  const dataSourceId = String(match.dataSourceId);
  if (!context.dataSources.some((source) => source.id === dataSourceId)) {
    throw new ProjectCapabilityManifestError("CAPABILITY_DATA_SOURCE_UNKNOWN", `Unknown capability data source: ${dataSourceId}.`);
  }
  return {
    dataSourceId,
    path: normalizeInnerPath(match.path),
    collection: String(match.collection),
    ...(match.rootField ? { rootField: String(match.rootField) } : {}),
    ...(match.nestedPath ? { nestedPath: [...match.nestedPath] } : {}),
  };
}

function normalizeResourcePath(value, context) {
  const normalized = String(value).replaceAll("\\", "/");
  if (!normalized || path.isAbsolute(normalized)) {
    throw new ProjectCapabilityManifestError("CAPABILITY_RESOURCE_OUTSIDE_ROOT", "Capability resources must be project-relative paths.");
  }
  try {
    resolveInsideRoot(context.projectRoot, normalized);
  } catch {
    throw new ProjectCapabilityManifestError("CAPABILITY_RESOURCE_OUTSIDE_ROOT", "Capability resources must stay inside the project root.");
  }
  return normalized;
}

function normalizeInnerPath(value) {
  const normalized = path.posix.normalize(String(value).replaceAll("\\", "/"));
  if (!normalized || normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new ProjectCapabilityManifestError("CAPABILITY_MATCH_PATH_INVALID", "Capability match path must stay inside its data source.");
  }
  return normalized;
}

function normalizeTransition(value) {
  return {
    id: String(value.id),
    previousManifestDigest: String(value.previousManifestDigest),
    removedBindingIds: [...new Set(value.removedBindingIds.map(String))].sort(),
  };
}

function genericAbsent(context) {
  return { status: "generic_absent", projectId: context.projectId, enrollment: null, manifest: null, manifestDigest: null };
}

function invalid(context, code, message, details = null) {
  return { status: "manifest_invalid", projectId: context.projectId, enrollment: null, manifest: null, manifestDigest: null, error: { code, message, details } };
}

async function readOptionalJson(filePath, invalidCode) {
  try {
    return { exists: true, value: JSON.parse(await readFile(filePath, "utf8")), error: null };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, value: null, error: null };
    if (error instanceof SyntaxError) return { exists: true, value: null, error: { code: invalidCode, message: `Invalid JSON: ${filePath}` } };
    throw error;
  }
}

function digest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const bindingSchema = {
  type: "object",
  required: ["id", "engine", "match"],
  properties: {
    id: { type: "string", pattern: "^[a-z0-9_-]+$" },
    engine: { type: "string" },
    match: {
      type: "object",
      required: ["dataSourceId", "path", "collection"],
      properties: {
        dataSourceId: { type: "string", minLength: 1 },
        path: { type: "string", minLength: 1 },
        collection: { type: "string", minLength: 1 },
        rootField: { type: "string", minLength: 1 },
        nestedPath: { type: "array", items: { type: "string", minLength: 1 } },
      },
      additionalProperties: false,
    },
  },
};

const manifestSchema = {
  type: "object",
  required: ["version", "requires", "capabilities"],
  properties: {
    version: { const: 1 },
    requires: {
      type: "object",
      required: ["capabilityApi"],
      properties: { capabilityApi: { const: 1 } },
      additionalProperties: false,
    },
    capabilities: {
      type: "object",
      properties: {
        nestedSchemas: {
          type: "array",
          items: {
            type: "object",
            allOf: [bindingSchema, { type: "object", required: ["manifest"], properties: { manifest: { type: "string", minLength: 1 } } }],
            unevaluatedProperties: false,
          },
        },
        documentContracts: {
          type: "array",
          items: {
            type: "object",
            allOf: [bindingSchema, { type: "object", required: ["contract", "contractSchema"], properties: { contract: { type: "string", minLength: 1 }, contractSchema: { type: "string", minLength: 1 } } }],
            unevaluatedProperties: false,
          },
        },
        identityPolicies: {
          type: "array",
          items: {
            type: "object",
            allOf: [bindingSchema, { type: "object",
              required: ["provider"],
              properties: {
                provider: {
                  type: "object",
                  required: ["kind"],
                  properties: { kind: { enum: ["embedded-v1", "declared-key-v1"] }, field: { type: "string", minLength: 1 } },
                  additionalProperties: false,
                },
                protectedIdentityFields: { type: "array", items: { type: "string", minLength: 1 } },
              },
            }],
            unevaluatedProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    transition: {
      type: "object",
      required: ["id", "previousManifestDigest", "removedBindingIds"],
      properties: {
        id: { type: "string", pattern: "^[a-z0-9_-]+$" },
        previousManifestDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
        removedBindingIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", pattern: "^[a-z0-9_-]+$" } },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};
