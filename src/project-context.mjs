import path from "node:path";

export const legacySharedViewConfigPath = "tools/data-editor/view-config.json";
export const legacyViewProfilesDir = "tools/data-editor/view-configs";
export const legacyBackupsDir = "tools/data-editor/.backups";

export const defaultSharedViewConfigPath = ".data-editor/view-config.json";
export const defaultProjectViewProfilesDir = ".data-editor/view-configs";
export const defaultBackupsDir = ".data-editor/backups";
export const defaultRuntimeDir = ".data-editor/runtime";
export const defaultLogsDir = ".data-editor/logs";

export function createProjectContext(input = {}) {
  if (typeof input === "string") {
    return createProjectContext({ projectRoot: input });
  }
  const projectRoot = path.resolve(input.projectRoot ?? input.root ?? process.cwd());
  const projectId = input.projectId ?? defaultProjectId(projectRoot);
  const profileBaseDir = input.profileBaseDir ?? process.env.DATA_EDITOR_PROFILE_HOME;
  const userViewProfilesDir = input.userViewProfilesDir
    ?? (profileBaseDir
      ? path.join(path.resolve(profileBaseDir), projectId)
      : path.join(projectRoot, defaultProjectViewProfilesDir));
  return {
    projectRoot,
    projectId,
    adapterId: input.adapterId ?? "nocturnel",
    dataRoot: input.dataRoot ?? "data",
    sharedViewConfigPath: input.sharedViewConfigPath ?? defaultSharedViewConfigPath,
    legacySharedViewConfigPath: input.legacySharedViewConfigPath ?? legacySharedViewConfigPath,
    userViewProfilesDir,
    legacyViewProfilesDir: input.legacyViewProfilesDir ?? legacyViewProfilesDir,
    backupsDir: input.backupsDir ?? defaultBackupsDir,
    legacyBackupsDir: input.legacyBackupsDir ?? legacyBackupsDir,
    runtimeDir: input.runtimeDir ?? defaultRuntimeDir,
    logsDir: input.logsDir ?? defaultLogsDir,
    filePolicy: input.filePolicy ?? {
      includeExtensions: [".json", ".csv"],
    },
  };
}

export function resolveProjectPath(projectContextOrRoot, relativePath) {
  const context = createProjectContext(projectContextOrRoot);
  return resolveInsideRoot(context.projectRoot, relativePath);
}

export function resolveInsideRoot(root, relativePath) {
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, relativePath);
  const relative = path.relative(rootAbs, target);
  if (relative && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new Error(`Path is outside project root: ${relativePath}`);
  }
  return target;
}

export function displayProjectPath(projectContextOrRoot, targetPath) {
  const context = createProjectContext(projectContextOrRoot);
  const absoluteTarget = path.resolve(targetPath);
  const relative = path.relative(context.projectRoot, absoluteTarget);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return relative.replaceAll("\\", "/");
  }
  return absoluteTarget;
}

function defaultProjectId(projectRoot) {
  const normalized = path.resolve(projectRoot).toLowerCase();
  return Buffer.from(normalized).toString("base64url");
}
