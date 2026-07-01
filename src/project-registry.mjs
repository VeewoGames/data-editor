import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const registryVersion = 1;
const validIdPattern = /^[a-z0-9_-]+$/;

export function dataEditorHome(env = process.env) {
  if (env.DATA_EDITOR_HOME) return path.resolve(env.DATA_EDITOR_HOME);
  if (env.APPDATA) return path.join(path.resolve(env.APPDATA), "data-editor");
  return path.join(os.homedir(), ".data-editor");
}

export function projectRegistryPath(options = {}) {
  return path.join(path.resolve(options.home ?? dataEditorHome(options.env)), "projects.json");
}

export function runtimeHome(options = {}) {
  return {
    projectRoot: path.resolve(options.home ?? dataEditorHome(options.env)),
    runtimeDir: "runtime",
    logsDir: "logs",
  };
}

export async function loadProjectRegistry(options = {}) {
  try {
    const parsed = JSON.parse(stripBom(await readFile(projectRegistryPath(options), "utf8")));
    return normalizeProjectRegistry(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return emptyProjectRegistry();
    throw error;
  }
}

export async function saveProjectRegistry(registry, options = {}) {
  const normalized = normalizeProjectRegistry(registry);
  validateProjectRegistry(normalized);
  const target = projectRegistryPath(options);
  await mkdir(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(tempPath, target);
  return normalized;
}

export async function addOrActivateProject(input, options = {}) {
  const registry = await loadProjectRegistry(options);
  const root = path.resolve(input.root ?? input.projectRoot ?? process.cwd());
  if (isFilesystemRoot(root)) throw new Error(`Project root cannot be a filesystem root: ${root}`);
  const existing = registry.projects.find((project) => samePath(project.root, root));
  if (existing) {
    registry.activeProjectId = existing.id;
    return { registry: await saveProjectRegistry(registry, options), project: existing };
  }

  const project = normalizeProjectDefinition({
    id: input.id ?? defaultProjectId(root, registry.projects),
    name: input.name ?? (path.basename(root) || "Project"),
    root,
    adapter: input.adapter ?? input.adapterId ?? "nocturnel",
    dataSources: input.dataSources ?? [{
      id: "data",
      label: "Data",
      path: "data",
      kind: "relative",
    }],
    filePolicy: input.filePolicy ?? { includeExtensions: [".json", ".csv"] },
    entryActions: input.entryActions ?? [],
  });
  registry.projects.push(project);
  registry.activeProjectId = project.id;
  return { registry: await saveProjectRegistry(registry, options), project };
}

export function emptyProjectRegistry() {
  return {
    version: registryVersion,
    activeProjectId: null,
    projects: [],
  };
}

export function normalizeProjectRegistry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyProjectRegistry();
  const projects = Array.isArray(value.projects)
    ? value.projects.map(normalizeProjectDefinition).filter((project) => !isFilesystemRoot(project.root))
    : [];
  const requestedActiveProjectId = typeof value.activeProjectId === "string" && value.activeProjectId.trim()
    ? value.activeProjectId.trim()
    : null;
  const activeProjectId = requestedActiveProjectId && projects.some((project) => project.id === requestedActiveProjectId)
    ? requestedActiveProjectId
    : projects[0]?.id ?? null;
  return {
    version: registryVersion,
    activeProjectId,
    projects,
  };
}

function normalizeProjectDefinition(value) {
  const root = path.resolve(String(value?.root ?? process.cwd()));
  return {
    id: String(value?.id ?? "").trim(),
    name: String(value?.name ?? value?.id ?? path.basename(root) ?? "Project").trim(),
    root,
    adapter: String(value?.adapter ?? value?.adapterId ?? "nocturnel").trim() || "nocturnel",
    dataSources: normalizeDataSources(value?.dataSources),
    filePolicy: {
      includeExtensions: normalizeIncludeExtensions(value?.filePolicy?.includeExtensions),
    },
    entryActions: normalizeEntryActions(value?.entryActions),
  };
}

function normalizeDataSources(value) {
  const sources = Array.isArray(value) && value.length > 0 ? value : [{
    id: "data",
    label: "Data",
    path: "data",
    kind: "relative",
  }];
  return sources.map((source) => ({
    id: String(source?.id ?? "").trim(),
    label: String(source?.label ?? source?.id ?? "").trim(),
    path: String(source?.path ?? "").trim(),
    kind: source?.kind === "absolute" ? "absolute" : "relative",
  }));
}

function normalizeIncludeExtensions(value) {
  const extensions = Array.isArray(value) ? value : [".json", ".csv"];
  return [...new Set(extensions
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim().toLowerCase()))];
}

function normalizeEntryActions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((action) => action && typeof action === "object" && !Array.isArray(action))
    .map((action) => ({
      id: String(action.id ?? "").trim(),
      label: String(action.label ?? "").trim(),
      icon: String(action.icon ?? "").trim(),
      targets: {
        files: normalizeActionTargetList(action.targets?.files),
        collections: normalizeActionTargetList(action.targets?.collections),
      },
      payload: {
        includeRow: action.payload?.includeRow !== false,
        includeNeighbors: action.payload?.includeNeighbors === true,
      },
    }));
}

function normalizeActionTargetList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim()))];
}

function validateProjectRegistry(registry) {
  const projectIds = new Set();
  const roots = new Set();
  for (const project of registry.projects) {
    validateId(project.id, "project");
    if (isFilesystemRoot(project.root)) throw new Error(`Project root cannot be a filesystem root: ${project.root}`);
    if (projectIds.has(project.id)) throw new Error(`Duplicate project id: ${project.id}`);
    projectIds.add(project.id);
    const rootKey = normalizePathKey(project.root);
    if (roots.has(rootKey)) throw new Error(`Duplicate project root: ${project.root}`);
    roots.add(rootKey);
    validateProjectDataSources(project);
    validateProjectEntryActions(project);
  }
  if (registry.activeProjectId != null && !projectIds.has(registry.activeProjectId)) {
    throw new Error(`Active project does not exist: ${registry.activeProjectId}`);
  }
}

function validateProjectDataSources(project) {
  const ids = new Set();
  const roots = new Set();
  for (const source of project.dataSources) {
    validateId(source.id, "data source");
    if (ids.has(source.id)) throw new Error(`Duplicate data source id: ${source.id}`);
    ids.add(source.id);
    if (!source.path) throw new Error(`Missing data source path: ${source.id}`);
    const sourceRoot = source.kind === "absolute"
      ? path.resolve(source.path)
      : path.resolve(project.root, source.path);
    const sourceRootKey = normalizePathKey(sourceRoot);
    if (roots.has(sourceRootKey)) throw new Error(`Duplicate data source root: ${sourceRoot}`);
    roots.add(sourceRootKey);
  }
}

function validateProjectEntryActions(project) {
  const actionIds = new Set();
  for (const action of project.entryActions ?? []) {
    validateId(action.id, "entry action");
    if (actionIds.has(action.id)) throw new Error(`Duplicate entry action id: ${action.id}`);
    actionIds.add(action.id);
    if (!action.label) throw new Error(`Missing entry action label: ${action.id}`);
    if (!action.icon) throw new Error(`Missing entry action icon: ${action.id}`);
    if (!Array.isArray(action.targets?.files) || action.targets.files.length === 0) {
      throw new Error(`Missing entry action target files: ${action.id}`);
    }
    if (!Array.isArray(action.targets?.collections) || action.targets.collections.length === 0) {
      throw new Error(`Missing entry action target collections: ${action.id}`);
    }
  }
}

function validateId(id, label) {
  if (!validIdPattern.test(id)) throw new Error(`Invalid ${label} id: ${id}`);
}

function defaultProjectId(root, existingProjects) {
  const base = sanitizeId(path.basename(root) || "project");
  const hash = crypto.createHash("sha1").update(normalizePathKey(root)).digest("hex").slice(0, 8);
  const candidate = `${base}-${hash}`;
  const existingIds = new Set(existingProjects.map((project) => project.id));
  if (!existingIds.has(candidate)) return candidate;
  let suffix = 2;
  while (existingIds.has(`${candidate}-${suffix}`)) suffix += 1;
  return `${candidate}-${suffix}`;
}

function sanitizeId(value) {
  const next = String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return next || "project";
}

function samePath(a, b) {
  return normalizePathKey(a) === normalizePathKey(b);
}

function normalizePathKey(value) {
  return path.resolve(String(value)).toLowerCase();
}

function isFilesystemRoot(value) {
  const resolved = path.resolve(String(value));
  return path.parse(resolved).root === resolved;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
