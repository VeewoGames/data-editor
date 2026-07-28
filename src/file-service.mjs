import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createProjectContext, resolveInsideRoot } from "./project-context.mjs";
import { atomicWrite } from "./atomic-file.mjs";

const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;

export { resolveInsideRoot };

export async function listDataFiles(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  const result = [];
  for (const source of context.dataSources) {
    const sourceRoot = dataSourceRoot(context, source);
    try {
      await walk(sourceRoot, source.id, result, source);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
  const includeExtensions = context.filePolicy?.includeExtensions ?? [".json", ".csv"];
  return result.filter((file) => includeExtensions.includes(path.extname(file.path).toLowerCase()));
}

export async function isAllowedDataFile(projectContextOrRoot, relativePath) {
  const context = createProjectContext(projectContextOrRoot);
  let normalized;
  try {
    normalized = normalizeDataFileVirtualPath(context, relativePath);
  } catch {
    return false;
  }
  return Boolean(await findAllowedDataFile(context, normalized));
}

export async function resolveAllowedDataFilePath(projectContextOrRoot, relativePath) {
  const context = createProjectContext(projectContextOrRoot);
  const normalized = normalizeDataFileVirtualPath(context, relativePath);
  const file = await findAllowedDataFile(context, normalized);
  if (!file) {
    throw new Error(`File is not in the data-editor allowlist: ${relativePath}`);
  }
  return {
    sourcePath: file.path,
    resolvedPath: resolveDataFilePath(context, file.path),
  };
}

export async function readTextFile(projectContextOrRoot, relativePath) {
  const context = createProjectContext(projectContextOrRoot);
  let target;
  try {
    ({ resolvedPath: target } = await resolveAllowedDataFilePath(context, relativePath));
  } catch (error) {
    if (isDataFileSelectionError(error)) {
      throw new Error(`File is not in the data-editor allowlist: ${relativePath}`);
    }
    throw error;
  }
  const info = await stat(target);
  if (info.size > MAX_PREVIEW_BYTES) {
    throw new Error("File is too large for MVP preview. Limit: 20 MB.");
  }
  return readFile(target, "utf8");
}

export async function writeTextFile(projectContextOrRoot, relativePath, text) {
  const context = createProjectContext(projectContextOrRoot);
  let target;
  try {
    ({ resolvedPath: target } = await resolveAllowedDataFilePath(context, relativePath));
  } catch (error) {
    if (isDataFileSelectionError(error)) {
      throw new Error(`Refusing to save file outside data-editor allowlist: ${relativePath}`);
    }
    throw error;
  }
  await atomicWrite(target, text);
  return { ok: true };
}

export function resolveDataFilePath(projectContextOrRoot, virtualPath) {
  const context = createProjectContext(projectContextOrRoot);
  const { source, innerPath } = parseVirtualDataPath(context, virtualPath);
  return resolveInsideRoot(dataSourceRoot(context, source), innerPath);
}

export function normalizeDataFileVirtualPath(projectContextOrRoot, virtualPath) {
  const context = createProjectContext(projectContextOrRoot);
  const { source, innerPath } = parseVirtualDataPath(context, virtualPath);
  resolveInsideRoot(dataSourceRoot(context, source), innerPath);
  return `${source.id}/${innerPath}`;
}

function parseVirtualDataPath(context, virtualPath) {
  const normalized = String(virtualPath ?? "").replaceAll("\\", "/");
  const separatorIndex = normalized.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) {
    throw new Error(`Invalid data-editor virtual path: ${virtualPath}`);
  }
  const sourceId = normalized.slice(0, separatorIndex);
  const innerPath = path.posix.normalize(normalized.slice(separatorIndex + 1));
  const source = context.dataSources.find((candidate) => candidate.id === sourceId);
  if (!source) throw new Error(`Unknown data source: ${sourceId}`);
  return { source, innerPath };
}

function dataSourceRoot(context, source) {
  return source.kind === "absolute"
    ? path.resolve(source.path)
    : resolveInsideRoot(context.projectRoot, source.path);
}

async function findAllowedDataFile(context, normalizedPath) {
  const includeExtensions = context.filePolicy?.includeExtensions ?? [".json", ".csv"];
  if (!includeExtensions.includes(path.extname(normalizedPath).toLowerCase())) return undefined;

  const separatorIndex = normalizedPath.indexOf("/");
  const sourceId = normalizedPath.slice(0, separatorIndex);
  const innerPath = normalizedPath.slice(separatorIndex + 1);
  const files = await listDataFiles(context);
  return files.find((file) => {
    if (file.dataSourceId !== sourceId) return false;
    if (process.platform !== "win32") return file.displayPath === innerPath;
    return file.displayPath.toLowerCase() === innerPath.toLowerCase();
  });
}

function isDataFileSelectionError(error) {
  const message = String(error?.message ?? "");
  return message.includes("data-editor allowlist")
    || message.startsWith("Invalid data-editor virtual path:")
    || message.startsWith("Unknown data source:")
    || message.startsWith("Path is outside project root:");
}

async function walk(absDir, relDir, result, source) {
  for (const entry of await readdir(absDir, { withFileTypes: true })) {
    const absPath = path.join(absDir, entry.name);
    const relPath = `${relDir}/${entry.name}`.replaceAll("\\", "/");
    if (entry.isDirectory()) {
      await walk(absPath, relPath, result, source);
    } else if (entry.isFile()) {
      const info = await stat(absPath);
      result.push({
        path: relPath,
        displayPath: relPath.slice(source.id.length + 1),
        dataSourceId: source.id,
        dataSourceLabel: source.label || source.id,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    }
  }
}
