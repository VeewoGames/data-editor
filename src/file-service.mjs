import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProjectContext, resolveInsideRoot } from "./project-context.mjs";

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
  const includeExtensions = context.filePolicy?.includeExtensions ?? [".json", ".csv"];
  if (!includeExtensions.includes(path.extname(relativePath).toLowerCase())) return false;
  const normalized = relativePath.replaceAll("\\", "/");
  const files = await listDataFiles(context);
  return files.some((file) => file.path === normalized);
}

export async function readTextFile(projectContextOrRoot, relativePath) {
  const context = createProjectContext(projectContextOrRoot);
  if (!await isAllowedDataFile(context, relativePath)) {
    throw new Error(`File is not in the data-editor allowlist: ${relativePath}`);
  }
  const target = resolveDataFilePath(context, relativePath);
  const info = await stat(target);
  if (info.size > MAX_PREVIEW_BYTES) {
    throw new Error("File is too large for MVP preview. Limit: 20 MB.");
  }
  return readFile(target, "utf8");
}

export async function writeTextFile(projectContextOrRoot, relativePath, text) {
  const context = createProjectContext(projectContextOrRoot);
  if (!await isAllowedDataFile(context, relativePath)) {
    throw new Error(`Refusing to save file outside data-editor allowlist: ${relativePath}`);
  }
  const target = resolveDataFilePath(context, relativePath);
  await writeFile(target, text, "utf8");
  return { ok: true };
}

export function resolveDataFilePath(projectContextOrRoot, virtualPath) {
  const context = createProjectContext(projectContextOrRoot);
  const { source, innerPath } = parseVirtualDataPath(context, virtualPath);
  return resolveInsideRoot(dataSourceRoot(context, source), innerPath);
}

function parseVirtualDataPath(context, virtualPath) {
  const normalized = String(virtualPath ?? "").replaceAll("\\", "/");
  const separatorIndex = normalized.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) {
    throw new Error(`Invalid data-editor virtual path: ${virtualPath}`);
  }
  const sourceId = normalized.slice(0, separatorIndex);
  const innerPath = normalized.slice(separatorIndex + 1);
  const source = context.dataSources.find((candidate) => candidate.id === sourceId);
  if (!source) throw new Error(`Unknown data source: ${sourceId}`);
  return { source, innerPath };
}

function dataSourceRoot(context, source) {
  return source.kind === "absolute"
    ? path.resolve(source.path)
    : resolveInsideRoot(context.projectRoot, source.path);
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
