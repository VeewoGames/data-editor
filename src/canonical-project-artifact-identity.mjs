import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { createProjectContext, resolveInsideRoot } from "./project-context.mjs";

export async function canonicalProjectArtifactIdentity(projectContextOrRoot, relativePath, options = {}) {
  const context = createProjectContext(projectContextOrRoot);
  const normalizedPath = normalizeArtifactPath(relativePath);
  const lstatImpl = options.lstatImpl ?? lstat;
  const realpathImpl = options.realpathImpl ?? realpath;
  const platform = options.platform ?? process.platform;
  const realRoot = await realpathImpl(context.projectRoot);
  const resolvedPath = resolveInsideRoot(realRoot, normalizedPath);
  await assertSafeExistingPath(realRoot, resolvedPath, lstatImpl);

  const canonicalPath = normalizeCanonicalPath(resolvedPath, platform);
  return {
    version: 1,
    relativePath: normalizedPath,
    resolvedPath,
    canonicalPath,
    canonicalFileKey: createHash("sha256").update(canonicalPath).digest("hex"),
  };
}

function normalizeArtifactPath(value) {
  const raw = String(value ?? "").replaceAll("\\", "/");
  const normalized = path.posix.normalize(raw);
  if (!raw || path.posix.isAbsolute(raw) || normalized !== raw || normalized.startsWith("../")
    || normalized === ".." || path.posix.extname(normalized).toLowerCase() !== ".md") {
    fail("ENTRY_ACTION_TEXT_ARTIFACT_PATH_INVALID");
  }
  return normalized;
}

async function assertSafeExistingPath(root, target, lstatImpl) {
  const relative = path.relative(root, target);
  const parts = relative.split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    let info;
    try {
      info = await lstatImpl(current);
    } catch (error) {
      if (error?.code === "ENOENT") {
        if (current !== target) fail("ENTRY_ACTION_TEXT_ARTIFACT_PARENT_MISSING", error);
        return;
      }
      throw error;
    }
    if (info.isSymbolicLink()) fail("ENTRY_ACTION_TEXT_ARTIFACT_LINK_REJECTED");
    if (current === target && !info.isFile()) fail("ENTRY_ACTION_TEXT_ARTIFACT_NOT_FILE");
    if (current !== target && !info.isDirectory()) fail("ENTRY_ACTION_TEXT_ARTIFACT_PARENT_INVALID");
  }
}

function normalizeCanonicalPath(value, platform) {
  const normalized = path.resolve(value).replaceAll("\\", "/");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function fail(code, cause) {
  throw Object.assign(new Error(code), { code, cause });
}
