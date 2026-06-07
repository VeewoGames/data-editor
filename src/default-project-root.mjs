import { readFileSync } from "node:fs";
import path from "node:path";
import { projectRegistryPath } from "./project-registry.mjs";

export function inferDefaultProjectRoot({
  toolRoot,
  cwd = process.cwd(),
  registryHome,
} = {}) {
  const resolvedToolRoot = path.resolve(toolRoot ?? cwd);
  if (isEmbeddedToolRoot(resolvedToolRoot)) {
    return path.resolve(resolvedToolRoot, "../..");
  }

  const activeProjectRoot = readActiveProjectRoot(registryHome);
  if (activeProjectRoot) return activeProjectRoot;
  return path.resolve(cwd);
}

function isEmbeddedToolRoot(toolRoot) {
  return path.basename(toolRoot).toLowerCase() === "data-editor"
    && path.basename(path.dirname(toolRoot)).toLowerCase() === "tools";
}

function readActiveProjectRoot(registryHome) {
  try {
    const registry = JSON.parse(readFileSync(projectRegistryPath({ home: registryHome }), "utf8"));
    const projects = Array.isArray(registry?.projects) ? registry.projects : [];
    if (!projects.length) return null;
    const activeProjectId = typeof registry?.activeProjectId === "string" && registry.activeProjectId.trim()
      ? registry.activeProjectId.trim()
      : projects[0]?.id;
    const activeProject = projects.find((project) => project?.id === activeProjectId) ?? projects[0];
    return activeProject?.root ? path.resolve(String(activeProject.root)) : null;
  } catch {
    return null;
  }
}
