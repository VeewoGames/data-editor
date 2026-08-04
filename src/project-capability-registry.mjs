import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "./atomic-file.mjs";
import { capabilityManifestDigest, loadProjectCapabilityManifest } from "./project-capability-manifest.mjs";
import { dataEditorHome } from "./project-registry.mjs";

export function capabilityLkgPath(projectId, options = {}) {
  if (!/^[a-z0-9_-]+$/.test(String(projectId))) throw new Error(`Invalid project id for capability LKG: ${projectId}`);
  return path.join(path.resolve(options.home ?? dataEditorHome(options.env)), "capabilities", "lkg", `${projectId}.json`);
}

export async function loadCapabilityLkg(projectId, options = {}) {
  const target = capabilityLkgPath(projectId, options);
  try {
    const snapshot = JSON.parse(await readFile(target, "utf8"));
    if (snapshot.checksum !== checksum({ ...snapshot, checksum: undefined })) return { status: "invalid", snapshot: null };
    return { status: "present", snapshot };
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "absent", snapshot: null };
    return { status: "invalid", snapshot: null };
  }
}

export async function saveCapabilityLkg(snapshot, options = {}) {
  const target = capabilityLkgPath(snapshot.projectId, options);
  const normalized = { ...snapshot, checksum: checksum({ ...snapshot, checksum: undefined }) };
  await mkdir(path.dirname(target), { recursive: true });
  await atomicWrite(target, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

/** Per-registry-project capability cache. A root-derived id is never used. */
export function createProjectCapabilityRegistry(options = {}) {
  const states = new Map();
  return {
    async resolve(project) {
      const projectId = String(project?.id ?? "").trim();
      if (!projectId) throw new Error("Capability registry requires registry project.id.");
      const context = { projectRoot: project.root, projectId, dataSources: project.dataSources, filePolicy: project.filePolicy };
      const loaded = await loadProjectCapabilityManifest(context);
      const lkg = await loadCapabilityLkg(projectId, options);
      const next = await compileCapabilityState(loaded, project, lkg, options);
      states.set(projectId, next);
      return next;
    },
    get(projectId) {
      return states.get(projectId) ?? null;
    },
    clear(projectId) {
      if (projectId == null) states.clear();
      else states.delete(projectId);
    },
    match(projectId, request) {
      return findCapabilityBinding(states.get(projectId), request);
    },
  };
}

export function findCapabilityBinding(state, { engine, dataSourceId, path: innerPath, collection, rootField = null, nestedPath = null }) {
  if (!state || state.status !== "active") return null;
  const bindings = engine === "nested-schema-v1"
    ? state.bindings.nestedSchemas
    : engine === "document-contract-v1"
      ? state.bindings.documentContracts
      : engine === "identity-policy-v1"
        ? state.bindings.identityPolicies
        : [];
  const matches = bindings.filter((binding) => binding.match.dataSourceId === dataSourceId
    && binding.match.path === innerPath
    && binding.match.collection === collection
    && (binding.match.rootField ?? null) === rootField
    && sameNestedPath(binding.match.nestedPath ?? null, nestedPath));
  if (matches.length > 1) throw new Error(`Ambiguous ${engine} capability binding for ${dataSourceId}/${innerPath}.`);
  return matches[0] ?? null;
}

async function compileCapabilityState(loaded, project, lkg, options) {
  if (loaded.status === "generic_absent") {
    if (lkg.status !== "absent") return degraded(project, lkg, { code: "CAPABILITY_ENROLLMENT_REMOVED", message: "An enrolled capability project cannot become generic by removing its declaration." });
    return { status: "generic_absent", projectId: project.id, generation: 0, bindings: emptyBindings(), manifestDigest: null };
  }
  if (lkg.status === "invalid") return degraded(project, lkg, { code: "CAPABILITY_LKG_INVALID", message: "Capability last-known-good snapshot is invalid." });
  if (loaded.status !== "active") {
    if (lkg.status === "present") return degraded(project, lkg, loaded.error ?? { code: "CAPABILITY_UNKNOWN" });
    return { status: "manifest_invalid", projectId: project.id, generation: 0, bindings: emptyBindings(), manifestDigest: null, error: loaded.error ?? { code: "CAPABILITY_UNKNOWN" } };
  }
  const resourceError = await validateDeclaredResources(project.root, loaded.manifest.capabilities);
  if (resourceError) {
    return {
      status: "contract_invalid",
      projectId: project.id,
      generation: lkg.snapshot?.generation ?? 0,
      manifestDigest: loaded.manifestDigest,
      bindings: loaded.manifest.capabilities,
      error: resourceError,
    };
  }
  const rootDigest = digest({ root: path.resolve(project.root), dataSources: project.dataSources });
  const bindingDigest = capabilityManifestDigest(loaded.manifest);
  const previous = lkg.status === "present" ? lkg.snapshot : null;
  const transitionError = validateBindingTransition(previous, loaded.manifest, bindingDigest);
  if (transitionError) return degraded(project, lkg, transitionError, loaded.manifest.capabilities, bindingDigest);
  const unchanged = previous
    && previous.rootDigest === rootDigest
    && previous.manifestDigest === bindingDigest
    && previous.capabilityApi === 1;
  const generation = unchanged ? previous.generation : Math.max(1, Number(previous?.generation ?? 0) + 1);
  const snapshot = await saveCapabilityLkg({
    version: 1,
    projectId: project.id,
    rootDigest,
    dataSourceDigest: digest(project.dataSources),
    manifestDigest: bindingDigest,
    capabilityApi: 1,
    generation,
    bindings: loaded.manifest.capabilities,
    ...(loaded.manifest.transition ? { lastTransitionId: loaded.manifest.transition.id } : {}),
  }, options);
  return {
    status: "active",
    projectId: project.id,
    generation,
    manifestDigest: bindingDigest,
    bindings: loaded.manifest.capabilities,
    lkg: snapshot,
  };
}

function degraded(project, lkg, error, bindings = lkg.snapshot?.bindings ?? emptyBindings(), manifestDigest = null) {
  return { status: "binding_degraded", projectId: project.id, generation: lkg.snapshot?.generation ?? 0, bindings, manifestDigest, error };
}

function validateBindingTransition(previous, manifest, manifestDigest) {
  if (!previous) return null;
  const previousBindings = allBindings(previous.bindings);
  const nextBindings = allBindings(manifest.capabilities);
  const retained = new Set(nextBindings.map((binding) => binding.id));
  const removed = previousBindings.filter((binding) => !retained.has(binding.id));
  const changed = previousBindings.filter((binding) => retained.has(binding.id) && JSON.stringify(binding.match) !== JSON.stringify(nextBindings.find((candidate) => candidate.id === binding.id).match));
  if (!removed.length && !changed.length) return null;
  if (changed.length) return { code: "CAPABILITY_BINDING_REBIND_UNSUPPORTED", message: "Changing an existing capability binding identity requires a future controlled rebind operation." };
  const transition = manifest.transition;
  const removedIds = removed.map((binding) => binding.id).sort();
  if (!transition
    || transition.previousManifestDigest !== previous.manifestDigest
    || JSON.stringify(transition.removedBindingIds) !== JSON.stringify(removedIds)) {
    return { code: "CAPABILITY_BINDING_REMOVAL_UNAUTHORIZED", message: "Removing capability bindings requires a matching controlled transition." };
  }
  if (previous.lastTransitionId === transition.id && previous.manifestDigest === manifestDigest) return null;
  return null;
}

function allBindings(bindings) {
  return [...(bindings?.nestedSchemas ?? []), ...(bindings?.documentContracts ?? []), ...(bindings?.identityPolicies ?? [])];
}

async function validateDeclaredResources(projectRoot, bindings) {
  const resources = [
    ...bindings.nestedSchemas.map((binding) => binding.manifest),
    ...bindings.documentContracts.flatMap((binding) => [binding.contract, binding.contractSchema]),
  ];
  for (const relativePath of resources) {
    const target = path.resolve(projectRoot, relativePath);
    try {
      JSON.parse(await readFile(target, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return { code: "CAPABILITY_RESOURCE_MISSING", message: `Capability resource is missing: ${relativePath}.` };
      if (error instanceof SyntaxError) return { code: "CAPABILITY_RESOURCE_INVALID_JSON", message: `Capability resource contains invalid JSON: ${relativePath}.` };
      throw error;
    }
  }
  return null;
}

function emptyBindings() {
  return { nestedSchemas: [], documentContracts: [], identityPolicies: [] };
}

function sameNestedPath(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((part, index) => part === b[index]);
}

function checksum(value) {
  return digest(value);
}

function digest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
