import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { createProjectContext } from "./project-context.mjs";
import {
  resolveAllowedDataFilePath,
} from "./file-service.mjs";

export async function canonicalFileIdentity(projectContextOrRoot, sourcePath, options = {}) {
  const context = createProjectContext(projectContextOrRoot);
  const { sourcePath: normalizedSourcePath, resolvedPath } = await resolveAllowedDataFilePath(context, sourcePath);
  const realpathImpl = options.realpathImpl ?? realpath;
  const platform = options.platform ?? process.platform;
  const canonicalPath = normalizeCanonicalPath(await realpathImpl(resolvedPath), platform);
  const canonicalFileKey = createHash("sha256").update(canonicalPath).digest("hex");

  return {
    version: 1,
    sourcePath: normalizedSourcePath,
    resolvedPath,
    canonicalPath,
    canonicalFileKey,
  };
}

function normalizeCanonicalPath(realPath, platform) {
  const absolutePath = path.resolve(realPath).replaceAll("\\", "/");
  return platform === "win32" ? absolutePath.toLowerCase() : absolutePath;
}
