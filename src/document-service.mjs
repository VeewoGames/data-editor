import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createProjectContext, resolveInsideRoot } from "./project-context.mjs";

export async function buildDocumentIndex(projectContextOrRoot, documentFiles, dataFilePath, options) {
  const context = createProjectContext(projectContextOrRoot);
  const docRoot = normalizeNonEmptyString(documentFiles?.[dataFilePath]?.docRoot);
  if (!docRoot) {
    return { docRoot: null, entries: {} };
  }
  const cache = await getDocumentCache(context.projectRoot, docRoot, options);
  return { docRoot, entries: cache.indexEntries };
}

export async function readResolvedDocument(projectContextOrRoot, documentFiles, dataFilePath, documentId, options) {
  const context = createProjectContext(projectContextOrRoot);
  const docRoot = normalizeNonEmptyString(documentFiles?.[dataFilePath]?.docRoot);
  const normalizedId = normalizeNonEmptyString(documentId);
  if (!docRoot) return { status: "missing", id: normalizedId };
  if (!normalizedId) return { status: "missing", id: normalizedId };
  const normalizedOptions = normalizeDocumentServiceOptions(options);
  const response = await readResolvedDocumentOnce(context.projectRoot, docRoot, normalizedId, normalizedOptions);
  if (response.status !== "missing" || normalizedOptions.forceRefresh) return response;
  return readResolvedDocumentOnce(context.projectRoot, docRoot, normalizedId, {
    forceRefresh: true,
  });
}

export function clearDocumentServiceCache() {
  documentCache.clear();
}

function extractDocumentTitle(content, relativePath) {
  const firstHeading = String(content ?? "").match(/^#\s+(.+?)\s*$/m);
  return firstHeading?.[1]?.trim() || path.basename(relativePath);
}

async function walkMarkdownFiles(absoluteDir, relativeDir, output) {
  let entries = [];
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name);
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkMarkdownFiles(absolutePath, relativePath, output);
      continue;
    }
    if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
      output.push(relativePath.replaceAll("\\", "/"));
    }
  }
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

const documentCache = new Map();

async function getDocumentCache(projectRoot, docRoot, options) {
  const cacheKey = `${projectRoot}\u0000${docRoot}`;
  const { forceRefresh } = normalizeDocumentServiceOptions(options);
  const cached = documentCache.get(cacheKey);
  if (cached && !forceRefresh) return cached;
  const absoluteDocRoot = resolveInsideRoot(projectRoot, docRoot);
  const files = [];
  await walkMarkdownFiles(absoluteDocRoot, "", files);
  const grouped = new Map();
  for (const relativePath of files) {
    const id = path.basename(relativePath, ".md");
    const current = grouped.get(id) ?? [];
    current.push(relativePath);
    grouped.set(id, current);
  }
  const indexEntries = {};
  const contentByRelativePath = {};
  for (const [id, matches] of grouped.entries()) {
    if (matches.length > 1) {
      indexEntries[id] = {
        status: "conflict",
        id,
        matches: [...matches].sort(),
      };
      continue;
    }
    const relativePath = matches[0];
    const content = await readFile(path.join(absoluteDocRoot, relativePath), "utf8");
    contentByRelativePath[relativePath] = content;
    indexEntries[id] = {
      status: "resolved",
      id,
      relativePath,
      title: extractDocumentTitle(content, relativePath),
    };
  }
  const nextCache = { indexEntries, contentByRelativePath };
  documentCache.set(cacheKey, nextCache);
  return nextCache;
}

async function readResolvedDocumentOnce(projectRoot, docRoot, documentId, options) {
  const cache = await getDocumentCache(projectRoot, docRoot, options);
  const entry = cache.indexEntries[documentId];
  if (!entry) return { status: "missing", id: documentId };
  if (entry.status !== "resolved") return entry;
  return {
    ...entry,
    content: cache.contentByRelativePath[entry.relativePath] ?? "",
  };
}

function normalizeDocumentServiceOptions(options) {
  return {
    forceRefresh: options?.forceRefresh === true,
  };
}
