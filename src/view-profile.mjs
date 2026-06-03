import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProjectContext, displayProjectPath, resolveInsideRoot } from "./project-context.mjs";

export async function listViewProfiles(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  const names = new Set([
    ...await listProfileNamesInDir(profileDir(context)),
    ...await listProfileNamesInDir(legacyProfileDir(context)),
  ]);
  return [...names].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export async function loadViewProfile(projectContextOrRoot, name) {
  const context = createProjectContext(projectContextOrRoot);
  const profileName = normalizeProfileName(name);
  const target = path.join(profileDir(context), `${profileName}.json`);
  try {
    const parsed = JSON.parse(await readFile(target, "utf8"));
    return normalizeViewProfile(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return loadLegacyViewProfile(context, profileName);
    throw error;
  }
}

export async function saveViewProfile(projectContextOrRoot, name, profile) {
  const context = createProjectContext(projectContextOrRoot);
  const profileName = normalizeProfileName(name);
  const target = path.join(profileDir(context), `${profileName}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(normalizeViewProfile(profile), null, 2)}\n`, "utf8");
  return { path: displayProjectPath(context, target), name: profileName };
}

export function emptyViewProfile() {
  return {
    sidebarWidth: null,
    fileOrder: [],
    collections: {},
  };
}

export function normalizeProfileName(name) {
  const value = String(name ?? "").trim();
  if (!value) throw new Error("View profile name is required");
  if (/[<>:"/\\|?*]/.test(value)) throw new Error(`View profile name contains unsupported characters: ${value}`);
  return value;
}

function normalizeViewProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyViewProfile();
  const collections = {};
  const rawCollections = value.collections;
  if (rawCollections && typeof rawCollections === "object" && !Array.isArray(rawCollections)) {
    for (const [key, rawEntry] of Object.entries(rawCollections)) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
      collections[key] = {
        hidden: normalizeStringArray(rawEntry.hidden),
        wrapped: normalizeStringArray(rawEntry.wrapped),
        order: normalizeStringArray(rawEntry.order),
        detailOrder: normalizeStringArray(rawEntry.detailOrder),
        widths: normalizeNumberRecord(rawEntry.widths),
      };
    }
  }
  return {
    sidebarWidth: Number.isFinite(value.sidebarWidth) ? Math.round(value.sidebarWidth) : null,
    fileOrder: normalizeStringArray(value.fileOrder),
    collections,
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) continue;
    const normalized = item.trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeNumberRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => Number.isFinite(item))
      .map(([key, item]) => [key, Math.round(Number(item))]),
  );
}

async function listProfileNamesInDir(targetDir) {
  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
      .map((entry) => path.basename(entry.name, ".json"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function loadLegacyViewProfile(context, profileName) {
  const target = path.join(legacyProfileDir(context), `${profileName}.json`);
  try {
    const parsed = JSON.parse(await readFile(target, "utf8"));
    return normalizeViewProfile(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return emptyViewProfile();
    throw error;
  }
}

function profileDir(context) {
  return path.resolve(context.userViewProfilesDir);
}

function legacyProfileDir(context) {
  return resolveInsideRoot(context.projectRoot, context.legacyViewProfilesDir);
}
