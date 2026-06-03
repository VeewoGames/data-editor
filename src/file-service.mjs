import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProjectContext, displayProjectPath, resolveInsideRoot } from "./project-context.mjs";

const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;

export { resolveInsideRoot };

export async function listDataFiles(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  const dataDir = resolveInsideRoot(context.projectRoot, context.dataRoot);
  const result = [];
  try {
    await walk(dataDir, context.dataRoot.replaceAll("\\", "/"), result);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
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
  const target = resolveInsideRoot(context.projectRoot, relativePath);
  const info = await stat(target);
  if (info.size > MAX_PREVIEW_BYTES) {
    throw new Error("File is too large for MVP preview. Limit: 20 MB.");
  }
  return readFile(target, "utf8");
}

export async function writeTextFileWithBackup(projectContextOrRoot, relativePath, text) {
  const context = createProjectContext(projectContextOrRoot);
  if (!await isAllowedDataFile(context, relativePath)) {
    throw new Error(`Refusing to save file outside data-editor allowlist: ${relativePath}`);
  }
  const target = resolveInsideRoot(context.projectRoot, relativePath);
  const backupDir = resolveInsideRoot(context.projectRoot, context.backupsDir);
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupName = `${relativePath.replaceAll("/", "__")}.${stamp}.bak`;
  const backupPath = path.join(backupDir, backupName);
  await copyFile(target, backupPath);
  await writeFile(target, text, "utf8");
  return { backupPath: displayProjectPath(context, backupPath) };
}

async function walk(absDir, relDir, result) {
  for (const entry of await readdir(absDir, { withFileTypes: true })) {
    const absPath = path.join(absDir, entry.name);
    const relPath = `${relDir}/${entry.name}`.replaceAll("\\", "/");
    if (entry.isDirectory()) {
      await walk(absPath, relPath, result);
    } else if (entry.isFile()) {
      const info = await stat(absPath);
      result.push({ path: relPath, size: info.size, modifiedAt: info.mtime.toISOString() });
    }
  }
}
