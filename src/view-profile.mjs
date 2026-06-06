import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProjectContext, displayProjectPath, resolveInsideRoot } from "./project-context.mjs";
import { normalizeSharedViewDraftState } from "./shared-views.mjs";

const defaultAppearanceThemeId = "light";
const defaultAppearanceBaseFontSize = 14;
const allowedAppearanceThemeIds = new Set(["light", "dark"]);
const allowedAppearanceBaseFontSizes = new Set([14, 14.5, 15, 16]);

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
    detailPanelWidth: null,
    fileOrder: [],
    lastActiveViews: {},
    viewDrafts: {},
    viewOrderDrafts: {},
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
  const sharedDrafts = normalizeSharedViewDraftState(value);
  const appearance = normalizeAppearance(value.appearance);
  return {
    sidebarWidth: Number.isFinite(value.sidebarWidth) ? Math.round(value.sidebarWidth) : null,
    detailPanelWidth: Number.isFinite(value.detailPanelWidth) ? Math.round(value.detailPanelWidth) : null,
    fileOrder: normalizeStringArray(value.fileOrder),
    lastActiveViews: sharedDrafts.lastActiveViews,
    viewDrafts: sharedDrafts.viewDrafts,
    viewOrderDrafts: sharedDrafts.viewOrderDrafts,
    ...(appearance ? { appearance } : {}),
    collections,
  };
}

function normalizeAppearance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const activeThemeId = normalizeThemeId(value.activeThemeId);
  const baseFontSize = normalizeBaseFontSize(value.baseFontSize);
  const themeOverrides = normalizeThemeOverrides(value.themeOverrides);
  if (!activeThemeId && !baseFontSize && !themeOverrides) return undefined;
  return {
    activeThemeId: activeThemeId ?? defaultAppearanceThemeId,
    baseFontSize: baseFontSize ?? defaultAppearanceBaseFontSize,
    ...(themeOverrides ? { themeOverrides } : {}),
  };
}

function normalizeThemeId(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return allowedAppearanceThemeIds.has(normalized) ? normalized : undefined;
}

function normalizeBaseFontSize(value) {
  if (!Number.isFinite(value)) return undefined;
  const normalized = Number(value);
  return allowedAppearanceBaseFontSizes.has(normalized) ? normalized : undefined;
}

function normalizeThemeOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const light = normalizeThemeOverrideRecord(value.light);
  const dark = normalizeThemeOverrideRecord(value.dark);
  if (!light && !dark) return undefined;
  return {
    ...(light ? { light } : {}),
    ...(dark ? { dark } : {}),
  };
}

function normalizeThemeOverrideRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .filter(([key, item]) => typeof key === "string" && key.trim() && typeof item === "string" && item.trim())
    .map(([key, item]) => [key.trim(), item.trim()]);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
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
