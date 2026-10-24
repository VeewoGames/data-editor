import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, stat } from "node:fs/promises";
import { atomicWrite } from "./atomic-file.mjs";
import { withProjectProcessLock } from "./project-process-lock.mjs";

export const registryVersion = 2;
const validIdPattern = /^[a-z0-9_-]+$/;
const registryWrites = new Map();

// Serialize the entire read/modify/write, including independent Windows servers.
export async function withProjectRegistryLock(operation, options = {}) {
  const target = projectRegistryPath(options);
  const key = process.platform === "win32" ? target.toLowerCase() : target;
  const previous = registryWrites.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  registryWrites.set(key, current);
  await previous;
  try {
    return process.platform === "win32"
      ? await withProjectProcessLock(`registry:${key}`, operation)
      : await operation();
  } finally {
    release();
    if (registryWrites.get(key) === current) registryWrites.delete(key);
  }
}

export async function mutateProjectRegistry(mutate, options = {}) {
  return withProjectRegistryLock(async () => {
    const registry = await loadProjectRegistry(options);
    await mutate(registry);
    return saveProjectRegistry(registry, options);
  }, options);
}

const registryError = (message, status = 400) => Object.assign(new Error(message), { status });

export function reorderProjects(projectIds, options = {}) {
  return mutateProjectRegistry(registry => {
    if (!Array.isArray(projectIds) || projectIds.some(id => typeof id !== "string") || new Set(projectIds).size !== projectIds.length) {
      throw registryError("项目排序必须包含不重复的项目 ID。");
    }
    const byId = new Map(registry.projects.map(project => [project.id, project]));
    if (projectIds.length !== byId.size || projectIds.some(id => !byId.has(id))) {
      throw registryError("项目列表已变化，请刷新后重新排序。", 409);
    }
    registry.projects = projectIds.map(id => byId.get(id));
  }, options);
}

export function updateProjectDefinition(input, options = {}) {
  return mutateProjectRegistry(registry => {
    if (!input?.id) throw registryError("Missing project id");
    const index = registry.projects.findIndex(project => project.id === input.id);
    if (index < 0) throw registryError(`Unknown project: ${input.id}`, 404);
    registry.projects[index] = { ...registry.projects[index], ...input };
  }, options);
}

export function removeProject(projectId, options = {}) {
  return mutateProjectRegistry(async registry => {
    const project = registry.projects.find(project => project.id === projectId);
    if (!project) throw registryError(`Unknown project: ${projectId}`, 404);
    if (registry.projects.length === 1) throw registryError("至少保留一个项目。", 409);
    await options.beforeRemove?.(project);
    registry.projects = registry.projects.filter(project => project.id !== projectId);
    if (registry.activeProjectId === projectId) registry.activeProjectId = registry.projects[0].id;
  }, options);
}

export function activateProject(projectId, options = {}) {
  return mutateProjectRegistry(registry => {
    if (!registry.projects.some(project => project.id === projectId)) throw registryError(`Unknown project: ${projectId}`, 404);
    registry.activeProjectId = projectId;
  }, options);
}

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
    if (parsed?.version !== registryVersion) throw registryMigrationRequired(parsed?.version);
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
  await atomicWrite(target, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export async function addOrActivateProject(input, options = {}) {
  let project;
  const registry = await mutateProjectRegistry(async registry => {
  const root = path.resolve(input.root ?? input.projectRoot ?? process.cwd());
  if (isFilesystemRoot(root)) throw new Error(`Project root cannot be a filesystem root: ${root}`);
  await assertProjectRootDirectory(root);
  const existing = registry.projects.find((project) => samePath(project.root, root));
  if (existing) {
    registry.activeProjectId = existing.id;
    project = existing;
    return;
  }

  project = normalizeProjectDefinition({
    id: input.id ?? defaultProjectId(root, registry.projects),
    name: input.name ?? (path.basename(root) || "Project"),
    root,
    dataSources: input.dataSources ?? [{
      id: "data",
      label: "Data",
      path: "data",
      kind: "relative",
    }],
    filePolicy: input.filePolicy ?? { includeExtensions: [".json", ".csv"] },
  });
  registry.projects.push(project);
  registry.activeProjectId = project.id;
  }, options);
  return { registry, project };
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
  if (value.version != null && value.version !== registryVersion) throw registryMigrationRequired(value.version);
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
  assertKnownProjectFields(value);
  const root = path.resolve(String(value?.root ?? process.cwd()));
  return {
    id: String(value?.id ?? "").trim(),
    name: String(value?.name ?? value?.id ?? path.basename(root) ?? "Project").trim(),
    root,
    dataSources: normalizeDataSources(value?.dataSources),
    filePolicy: {
      includeExtensions: normalizeIncludeExtensions(value?.filePolicy?.includeExtensions),
    },
  };
}

export function migrateProjectRegistryV1(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) throw registryMigrationRequired(value?.version);
  return normalizeProjectRegistry({
    version: registryVersion,
    activeProjectId: value.activeProjectId,
    projects: Array.isArray(value.projects) ? value.projects.map(({ adapter, adapterId, entryActions, ...project }) => project) : [],
  });
}

function assertKnownProjectFields(value) {
  const allowed = new Set(["id", "name", "root", "dataSources", "filePolicy"]);
  for (const key of Object.keys(value ?? {})) {
    if (!allowed.has(key)) throw new Error(`Unknown project registry field: ${key}`);
  }
}

async function assertProjectRootDirectory(root) {
  try {
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error(`Project root is not a directory: ${root}`);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Project root does not exist: ${root}`);
    throw error;
  }
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

function registryMigrationRequired(version) {
  return Object.assign(new Error(`Project registry version ${version ?? "missing"} requires migration: npm run registry:migrate:v2 -- --registry-home <path>`), { code: "PROJECT_REGISTRY_MIGRATION_REQUIRED" });
}
