import { access, readdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { resolveCodexSkillSearchRoots } from "./codex-runtime.mjs";

export async function loadAutomationSkillCatalog(options = {}) {
  const projectRoot = typeof options.projectRoot === "string" && options.projectRoot.trim()
    ? path.resolve(options.projectRoot)
    : null;
  const roots = resolveCodexSkillSearchRoots(projectRoot);
  const skillsById = new Map();

  for (const root of roots) {
    let entries = [];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name.trim();
      if (!id || skillsById.has(id)) continue;
      if (!await hasSkillFile(path.join(root, id, "SKILL.md"))) continue;
      skillsById.set(id, {
        id,
        label: id,
        source: describeSkillCatalogSource(root, projectRoot),
      });
    }
  }

  return {
    provider: "codex",
    loadedAt: new Date().toISOString(),
    skills: [...skillsById.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function hasSkillFile(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function describeSkillCatalogSource(root, projectRoot) {
  const normalizedRoot = path.resolve(root);
  if (projectRoot && normalizedRoot === path.resolve(projectRoot, ".agents", "skills")) return "project-agents";
  const userProfile = process.env.USERPROFILE ? path.resolve(process.env.USERPROFILE) : null;
  if (!userProfile) return "unknown";
  if (normalizedRoot === path.resolve(userProfile, ".codex", "skills")) return "user-codex-home";
  if (normalizedRoot === path.resolve(userProfile, ".agents", "skills")) return "user-agents-home";
  return "unknown";
}
