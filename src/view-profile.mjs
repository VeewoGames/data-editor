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
  await writeFile(target, `${JSON.stringify(serializeViewProfile(profile), null, 2)}\n`, "utf8");
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
    viewLayouts: {},
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
  const sharedDrafts = normalizeSharedViewDraftState(value);
  const appearance = normalizeAppearance(value.appearance);
  const viewLayouts = normalizeViewLayouts(value.viewLayouts);
  migrateLegacyCollectionsToViewLayouts(viewLayouts, value.collections, sharedDrafts.lastActiveViews);
  const collections = deriveLegacyCollections(viewLayouts, sharedDrafts.lastActiveViews);
  return {
    sidebarWidth: Number.isFinite(value.sidebarWidth) ? Math.round(value.sidebarWidth) : null,
    detailPanelWidth: Number.isFinite(value.detailPanelWidth) ? Math.round(value.detailPanelWidth) : null,
    fileOrder: normalizeStringArray(value.fileOrder),
    lastActiveViews: sharedDrafts.lastActiveViews,
    viewDrafts: sharedDrafts.viewDrafts,
    viewOrderDrafts: sharedDrafts.viewOrderDrafts,
    ...(appearance ? { appearance } : {}),
    viewLayouts,
    collections,
  };
}

function normalizeViewLayouts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [collectionKey, rawViews] of Object.entries(value)) {
    if (!rawViews || typeof rawViews !== "object" || Array.isArray(rawViews)) continue;
    const normalizedViews = {};
    for (const [viewId, rawLayout] of Object.entries(rawViews)) {
      const normalizedViewId = normalizeNonEmptyString(viewId);
      if (!normalizedViewId || !rawLayout || typeof rawLayout !== "object" || Array.isArray(rawLayout)) continue;
      normalizedViews[normalizedViewId] = normalizeLayoutState(rawLayout);
    }
    if (Object.keys(normalizedViews).length) result[collectionKey] = normalizedViews;
  }
  return result;
}

function migrateLegacyCollectionsToViewLayouts(viewLayouts, legacyCollections, lastActiveViews) {
  if (!legacyCollections || typeof legacyCollections !== "object" || Array.isArray(legacyCollections)) return;
  for (const [collectionKey, rawLayout] of Object.entries(legacyCollections)) {
    const viewId = normalizeNonEmptyString(lastActiveViews?.[collectionKey]);
    if (!viewId || !rawLayout || typeof rawLayout !== "object" || Array.isArray(rawLayout)) continue;
    viewLayouts[collectionKey] ??= {};
    viewLayouts[collectionKey][viewId] ??= normalizeLayoutState(rawLayout);
  }
}

function deriveLegacyCollections(viewLayouts, lastActiveViews) {
  const result = {};
  for (const [collectionKey, viewId] of Object.entries(lastActiveViews ?? {})) {
    const normalizedViewId = normalizeNonEmptyString(viewId);
    if (!normalizedViewId) continue;
    const layout = viewLayouts[collectionKey]?.[normalizedViewId];
    if (!layout) continue;
    result[collectionKey] = cloneLayoutState(layout);
  }
  return result;
}

function normalizeLayoutState(value) {
  return {
    hidden: normalizeStringArray(value.hidden),
    wrapped: normalizeStringArray(value.wrapped),
    order: normalizeStringArray(value.order),
    detailOrder: normalizeStringArray(value.detailOrder),
    widths: normalizeNumberRecord(value.widths),
  };
}

function cloneLayoutState(value) {
  return {
    hidden: [...value.hidden],
    wrapped: [...value.wrapped],
    order: [...value.order],
    detailOrder: [...value.detailOrder],
    widths: { ...value.widths },
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

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
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

function serializeViewProfile(profile) {
  const normalized = normalizeViewProfile(profile);
  return {
    sidebarWidth: normalized.sidebarWidth,
    detailPanelWidth: normalized.detailPanelWidth,
    fileOrder: normalized.fileOrder,
    lastActiveViews: normalized.lastActiveViews,
    viewDrafts: normalized.viewDrafts,
    viewOrderDrafts: normalized.viewOrderDrafts,
    ...(normalized.appearance ? { appearance: normalized.appearance } : {}),
    viewLayouts: normalized.viewLayouts,
  };
}

function profileDir(context) {
  return path.resolve(context.userViewProfilesDir);
}

function legacyProfileDir(context) {
  return resolveInsideRoot(context.projectRoot, context.legacyViewProfilesDir);
}
