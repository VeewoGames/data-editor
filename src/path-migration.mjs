import { syncBacklinksWithRelations } from "./model/field-role.mjs";

export const fingerprintCacheStorageKey = "data-editor:__file-fingerprints";

function emptyReport() {
  return { migrated: [], conflicts: [], skipped: [] };
}

function mergeReports(...reports) {
  const merged = emptyReport();
  for (const report of reports) {
    if (!report) continue;
    merged.migrated.push(...(report.migrated ?? []));
    merged.conflicts.push(...(report.conflicts ?? []));
    merged.skipped.push(...(report.skipped ?? []));
  }
  return merged;
}

function withResult(value, changed = false, report = emptyReport()) {
  return { value, changed, report };
}

export function normalizePathForMigration(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function normalizeMigration(migration) {
  const oldPath = normalizePathForMigration(migration?.oldPath);
  const newPath = normalizePathForMigration(migration?.newPath);
  if (!oldPath || !newPath || oldPath === newPath || migration?.confidence !== "high") return null;
  return { ...migration, oldPath, newPath, confidence: "high" };
}

function normalizedMigrations(migrations) {
  return (Array.isArray(migrations) ? migrations : []).map(normalizeMigration).filter(Boolean);
}

function normalizeFilePath(file) {
  return normalizePathForMigration(typeof file === "string" ? file : file?.path);
}

function pathDir(filePath) {
  const index = filePath.lastIndexOf("/");
  return index >= 0 ? filePath.slice(0, index) : "";
}

function pathBase(filePath) {
  const index = filePath.lastIndexOf("/");
  return index >= 0 ? filePath.slice(index + 1) : filePath;
}

function fingerprintIdentity(fingerprint) {
  if (!fingerprint) return null;
  const extension = String(fingerprint.extension ?? "").trim();
  const contentHash = String(fingerprint.contentHash ?? "").trim();
  const schemaSignature = String(fingerprint.schemaSignature ?? "").trim();
  if (!extension || !contentHash || !schemaSignature) return null;
  return `${extension}\u0000${contentHash}\u0000${schemaSignature}`;
}

function inferReason(oldPath, newPath) {
  if (pathBase(oldPath) !== pathBase(newPath) && pathDir(oldPath) === pathDir(newPath)) return "rename";
  return "file-move";
}

export function readFingerprintCache(storage) {
  const fallback = { version: 1, files: {} };
  const rawValue = storage?.getItem?.(fingerprintCacheStorageKey);
  if (!rawValue) return fallback;
  try {
    const parsed = JSON.parse(rawValue);
    if (parsed?.version !== 1 || !parsed.files || typeof parsed.files !== "object" || Array.isArray(parsed.files)) {
      return fallback;
    }
    const files = {};
    for (const [path, entry] of Object.entries(parsed.files)) {
      const normalizedPath = normalizePathForMigration(path);
      if (!normalizedPath || !entry?.fingerprint) continue;
      files[normalizedPath] = {
        size: Number(entry.size) || 0,
        modifiedAt: String(entry.modifiedAt ?? ""),
        fingerprint: { ...entry.fingerprint, path: normalizePathForMigration(entry.fingerprint.path || normalizedPath) },
      };
    }
    return { version: 1, files };
  } catch {
    return fallback;
  }
}

export function writeFingerprintCache(storage, cache) {
  const normalized = normalizeFingerprintCache(cache);
  const nextValue = JSON.stringify(normalized);
  const previousValue = storage?.getItem?.(fingerprintCacheStorageKey);
  if (previousValue === nextValue) return { value: normalized, changed: false, report: emptyReport() };
  storage?.setItem?.(fingerprintCacheStorageKey, nextValue);
  return { value: normalized, changed: true, report: emptyReport() };
}

function normalizeFingerprintCache(cache) {
  const files = {};
  for (const [path, entry] of Object.entries(cache?.files ?? {})) {
    const normalizedPath = normalizePathForMigration(path);
    if (!normalizedPath || !entry?.fingerprint) continue;
    files[normalizedPath] = {
      size: Number(entry.size) || 0,
      modifiedAt: String(entry.modifiedAt ?? ""),
      fingerprint: { ...entry.fingerprint, path: normalizePathForMigration(entry.fingerprint.path || normalizedPath) },
    };
  }
  return { version: 1, files };
}

export function updateFingerprintCache(cache, files, fingerprints) {
  const next = normalizeFingerprintCache(cache);
  const byPath = new Map();
  for (const fingerprint of Array.isArray(fingerprints) ? fingerprints : []) {
    const path = normalizePathForMigration(fingerprint?.path);
    if (path) byPath.set(path, fingerprint);
  }
  const report = emptyReport();
  for (const file of Array.isArray(files) ? files : []) {
    const path = normalizeFilePath(file);
    const fingerprint = byPath.get(path);
    if (!path || !fingerprint) {
      if (path) report.skipped.push({ surface: "fingerprintCache", path, reason: "missing-fingerprint" });
      continue;
    }
    next.files[path] = {
      size: Number(file?.size ?? fingerprint.size) || 0,
      modifiedAt: String(file?.modifiedAt ?? fingerprint.modifiedAt ?? ""),
      fingerprint: { ...fingerprint, path },
    };
    report.migrated.push({ surface: "fingerprintCache", oldPath: path, newPath: path });
  }
  return { value: next, changed: report.migrated.length > 0, report };
}

export function migrateFingerprintCache(cache, migrations) {
  const next = normalizeFingerprintCache(cache);
  const report = emptyReport();
  for (const migration of normalizedMigrations(migrations)) {
    const entry = next.files[migration.oldPath];
    if (!entry) {
      report.skipped.push({ surface: "fingerprintCache", path: migration.oldPath, reason: "missing-cache-entry" });
      continue;
    }
    if (next.files[migration.newPath]) {
      report.conflicts.push({
        surface: "fingerprintCache",
        oldKey: migration.oldPath,
        newKey: migration.newPath,
        action: "kept-new",
      });
      continue;
    }
    next.files[migration.newPath] = {
      ...entry,
      fingerprint: { ...entry.fingerprint, path: migration.newPath },
    };
    delete next.files[migration.oldPath];
    report.migrated.push({ surface: "fingerprintCache", oldPath: migration.oldPath, newPath: migration.newPath });
  }
  return { value: next, changed: report.migrated.length > 0, report };
}

export async function detectPathMigrations({
  previousFiles,
  nextFiles,
  fingerprintCache,
  readFingerprint,
}) {
  const report = emptyReport();
  const previousByPath = new Map((previousFiles ?? []).map((file) => [normalizeFilePath(file), file]).filter(([path]) => path));
  const nextByPath = new Map((nextFiles ?? []).map((file) => [normalizeFilePath(file), file]).filter(([path]) => path));
  const removed = [...previousByPath.keys()].filter((path) => !nextByPath.has(path));
  const added = [...nextByPath.keys()].filter((path) => !previousByPath.has(path));
  const cache = normalizeFingerprintCache(fingerprintCache);
  const oldEntries = [];
  const newEntries = [];

  for (const oldPath of removed) {
    const cached = cache.files[oldPath]?.fingerprint;
    if (!cached) {
      report.skipped.push({ surface: "detectPathMigrations", path: oldPath, reason: "fingerprint-cache-miss" });
      continue;
    }
    const identity = fingerprintIdentity(cached);
    if (!identity) {
      report.skipped.push({ surface: "detectPathMigrations", path: oldPath, reason: "invalid-fingerprint" });
      continue;
    }
    oldEntries.push({ path: oldPath, identity });
  }

  for (const newPath of added) {
    const file = nextByPath.get(newPath);
    const fingerprint = await readFingerprint?.(file);
    const identity = fingerprintIdentity(fingerprint);
    if (!identity) {
      report.skipped.push({ surface: "detectPathMigrations", path: newPath, reason: "invalid-fingerprint" });
      continue;
    }
    newEntries.push({ path: newPath, identity });
  }

  const oldByIdentity = groupBy(oldEntries, (entry) => entry.identity);
  const newByIdentity = groupBy(newEntries, (entry) => entry.identity);
  const migrations = [];
  for (const [identity, oldMatches] of oldByIdentity.entries()) {
    const newMatches = newByIdentity.get(identity) ?? [];
    if (oldMatches.length === 1 && newMatches.length === 1) {
      const oldPath = oldMatches[0].path;
      const newPath = newMatches[0].path;
      migrations.push({ oldPath, newPath, reason: inferReason(oldPath, newPath), confidence: "high" });
      report.migrated.push({ surface: "detectPathMigrations", oldPath, newPath });
      continue;
    }
    for (const entry of [...oldMatches, ...newMatches]) {
      report.skipped.push({ surface: "detectPathMigrations", path: entry.path, reason: "fingerprint-not-unique" });
    }
  }

  return { migrations: markFolderMoves(migrations), report };
}

function groupBy(values, keyFn) {
  const map = new Map();
  for (const value of values) {
    const key = keyFn(value);
    map.set(key, [...(map.get(key) ?? []), value]);
  }
  return map;
}

function markFolderMoves(migrations) {
  const byDirPair = groupBy(migrations, (migration) => `${pathDir(migration.oldPath)}\u0000${pathDir(migration.newPath)}`);
  const folderPairs = new Set([...byDirPair.entries()].filter(([, items]) => items.length >= 2).map(([key]) => key));
  return migrations.map((migration) => {
    const key = `${pathDir(migration.oldPath)}\u0000${pathDir(migration.newPath)}`;
    return folderPairs.has(key) ? { ...migration, reason: "folder-move" } : migration;
  });
}

export function rewritePath(value, migrations) {
  const normalizedValue = normalizePathForMigration(value);
  for (const migration of normalizedMigrations(migrations)) {
    if (normalizedValue === migration.oldPath) return withResult(migration.newPath, true, {
      ...emptyReport(),
      migrated: [{ surface: "path", oldPath: migration.oldPath, newPath: migration.newPath }],
    });
  }
  return withResult(value, false);
}

export function rewriteCollectionConfigKey(key, migrations, context = {}) {
  const source = String(key ?? "");
  for (const migration of normalizedMigrations(migrations)) {
    const prefix = `${migration.oldPath}:`;
    if (!source.startsWith(prefix)) continue;
    const collectionPath = source.slice(prefix.length);
    if (!collectionPath) break;
    if (!isKnownCollectionPath(migration.oldPath, collectionPath, context)) {
      return skippedKey(source, "collectionConfig", "unknown-collection-path");
    }
    const value = `${migration.newPath}:${collectionPath}`;
    return withResult(value, value !== source, {
      ...emptyReport(),
      migrated: [{ surface: "collectionConfig", oldKey: source, newKey: value }],
    });
  }
  return withResult(key, false);
}

export function rewriteFieldViewConfigKey(key, migrations, context = {}) {
  return rewritePathCollectionFieldKey(key, migrations, context, "fieldViewConfig");
}

export function rewriteRelationKey(key, migrations, context = {}) {
  return rewritePathCollectionFieldKey(key, migrations, context, "relation");
}

function rewritePathCollectionFieldKey(key, migrations, context, surface) {
  const source = String(key ?? "");
  for (const migration of normalizedMigrations(migrations)) {
    const collectionPaths = collectionPathCandidates(migration.oldPath, source, context, true);
    for (const collectionPath of collectionPaths) {
      const prefix = `${migration.oldPath}:${collectionPath}:`;
      if (!source.startsWith(prefix)) continue;
      const value = `${migration.newPath}:${collectionPath}:${source.slice(prefix.length)}`;
      return withResult(value, value !== source, {
        ...emptyReport(),
        migrated: [{ surface, oldKey: source, newKey: value }],
      });
    }
    if (source.startsWith(`${migration.oldPath}:`)) return skippedKey(source, surface, "unknown-collection-path");
  }
  return withResult(key, false);
}

export function rewriteLocalViewStorageKey(key, migrations, context = {}) {
  const source = String(key ?? "");
  if (!source.startsWith("data-editor:")) return withResult(key, false);
  for (const migration of normalizedMigrations(migrations)) {
    const collectionKeys = collectionKeysForMigration(migration.oldPath, context);
    for (const oldCollectionKey of collectionKeys) {
      const globalDetailOrderPrefix = `data-editor:${oldCollectionKey}:__detail-order`;
      if (source === globalDetailOrderPrefix) {
        const newCollectionKey = `${migration.newPath}:${oldCollectionKey.slice(`${migration.oldPath}:`.length)}`;
        const value = `data-editor:${newCollectionKey}:__detail-order`;
        return withResult(value, true, {
          ...emptyReport(),
          migrated: [{ surface: "localViewStorage", oldKey: source, newKey: value }],
        });
      }
      const viewIds = context?.viewIdsByCollectionKey?.[oldCollectionKey] ?? [];
      const collectionPath = oldCollectionKey.slice(`${migration.oldPath}:`.length);
      for (const viewId of viewIds) {
        const oldPrefix = `data-editor:${migration.oldPath}:${collectionPath}:${encodeURIComponent(String(viewId).trim())}:`;
        if (!source.startsWith(oldPrefix)) continue;
        const newPrefix = `data-editor:${migration.newPath}:${collectionPath}:${encodeURIComponent(String(viewId).trim())}:`;
        const value = `${newPrefix}${source.slice(oldPrefix.length)}`;
        return withResult(value, true, {
          ...emptyReport(),
          migrated: [{ surface: "localViewStorage", oldKey: source, newKey: value }],
        });
      }
    }
    if (source.startsWith(`data-editor:${migration.oldPath}:`)) {
      return skippedKey(source, "localViewStorage", "unknown-view-prefix");
    }
  }
  return withResult(key, false);
}

export function rewritePageScrollContextKey(key, migrations, context = {}) {
  const source = String(key ?? "");
  for (const migration of normalizedMigrations(migrations)) {
    const collectionPaths = collectionPathCandidates(migration.oldPath, source, context, true);
    for (const collectionPath of collectionPaths) {
      const prefix = `${migration.oldPath}:${collectionPath}:`;
      if (!source.startsWith(prefix)) continue;
      const value = `${migration.newPath}:${collectionPath}:${source.slice(prefix.length)}`;
      return withResult(value, true, {
        ...emptyReport(),
        migrated: [{ surface: "pageScrollContext", oldKey: source, newKey: value }],
      });
    }
    if (source.startsWith(`${migration.oldPath}:`)) return skippedKey(source, "pageScrollContext", "unknown-collection-path");
  }
  return withResult(key, false);
}

function collectionKeysForMigration(oldPath, context) {
  const keys = Object.keys(context?.viewIdsByCollectionKey ?? {}).filter((key) => key.startsWith(`${oldPath}:`));
  for (const collectionPath of context?.collectionPathsByFile?.[oldPath] ?? []) {
    keys.push(`${oldPath}:${collectionPath}`);
  }
  return [...new Set(keys)];
}

function collectionPathCandidates(oldPath, key, context, allowInfer) {
  const known = context?.collectionPathsByFile?.[oldPath];
  if (Array.isArray(known) && known.length) return [...known].sort((a, b) => b.length - a.length);
  if (!allowInfer) return [];
  const prefix = `${oldPath}:`;
  if (!String(key).startsWith(prefix)) return [];
  const rest = String(key).slice(prefix.length);
  const index = rest.indexOf(":");
  if (index < 0) return [rest].filter(Boolean);
  return [rest.slice(0, index)].filter(Boolean);
}

function isKnownCollectionPath(oldPath, collectionPath, context) {
  const known = context?.collectionPathsByFile?.[oldPath];
  return !Array.isArray(known) || known.length === 0 || known.includes(collectionPath);
}

function skippedKey(key, surface, reason) {
  return withResult(key, false, { ...emptyReport(), skipped: [{ surface, key, reason }] });
}

function migrateObjectKeys(object, rewriteFn, migrations, context, surface) {
  const next = {};
  const report = emptyReport();
  let changed = false;
  for (const [key, value] of Object.entries(object ?? {})) {
    const rewritten = rewriteFn(key, migrations, context);
    report.skipped.push(...rewritten.report.skipped);
    if (!rewritten.changed) {
      next[key] = cloneValue(value);
      continue;
    }
    if (Object.hasOwn(object, rewritten.value)) {
      next[key] = cloneValue(value);
      report.conflicts.push({ surface, oldKey: key, newKey: rewritten.value, action: "kept-new" });
      continue;
    }
    next[rewritten.value] = cloneValue(value);
    changed = true;
    report.migrated.push(...rewritten.report.migrated);
  }
  return { value: next, changed: changed || report.conflicts.length > 0 || report.skipped.length > 0, report };
}

function cloneValue(value) {
  if (value == null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

export function rewriteFileOrder(fileOrder, migrations) {
  const report = emptyReport();
  const seen = new Set();
  const value = [];
  let changed = false;
  for (const item of Array.isArray(fileOrder) ? fileOrder : []) {
    const rewritten = rewritePath(item, migrations);
    const nextPath = rewritten.value;
    if (rewritten.changed) {
      changed = true;
      report.migrated.push({ surface: "fileOrder", oldPath: item, newPath: nextPath });
    }
    if (!nextPath || seen.has(nextPath)) {
      changed = true;
      continue;
    }
    seen.add(nextPath);
    value.push(nextPath);
  }
  return { value, changed, report };
}

export function rewriteSidebarTreePreferences(sidebarTree, migrations, folderMigrations = []) {
  const normalizedFolderMigrations = [
    ...deriveFolderMigrations(migrations),
    ...(Array.isArray(folderMigrations) ? folderMigrations : []),
  ];
  const rewriteId = (id) => rewriteSidebarNodeId(id, migrations, normalizedFolderMigrations);
  const report = emptyReport();
  const childOrderByParent = {};
  let changed = false;

  for (const [parentId, childIds] of Object.entries(sidebarTree?.childOrderByParent ?? {})) {
    const nextParentId = rewriteId(parentId);
    const nextChildIds = [];
    const seen = new Set();
    for (const childId of Array.isArray(childIds) ? childIds : []) {
      const nextChildId = rewriteId(childId);
      if (nextChildId !== childId) changed = true;
      if (!nextChildId || seen.has(nextChildId)) continue;
      seen.add(nextChildId);
      nextChildIds.push(nextChildId);
    }
    if (nextParentId !== parentId) changed = true;
    childOrderByParent[nextParentId] = nextChildIds;
  }

  const expandedNodeIds = [];
  const seenExpanded = new Set();
  for (const id of Array.isArray(sidebarTree?.expandedNodeIds) ? sidebarTree.expandedNodeIds : []) {
    const nextId = rewriteId(id);
    if (nextId !== id) changed = true;
    if (!nextId || seenExpanded.has(nextId)) continue;
    seenExpanded.add(nextId);
    expandedNodeIds.push(nextId);
  }
  if (changed) report.migrated.push({ surface: "sidebarTree" });
  return { value: { childOrderByParent, expandedNodeIds }, changed, report };
}

function rewriteSidebarNodeId(id, migrations, folderMigrations) {
  const value = String(id ?? "");
  for (const migration of normalizedMigrations(migrations)) {
    if (value === `file:${migration.oldPath}`) return `file:${migration.newPath}`;
  }
  for (const migration of folderMigrations) {
    const oldId = `folder:${migration.dataSourceId ?? "default"}/${migration.oldFolderPath}`;
    const newId = `folder:${migration.dataSourceId ?? "default"}/${migration.newFolderPath}`;
    if (value === oldId || value.startsWith(`${oldId}/`)) return `${newId}${value.slice(oldId.length)}`;
  }
  return value;
}

function deriveFolderMigrations(migrations) {
  const result = [];
  const seen = new Set();
  for (const migration of normalizedMigrations(migrations)) {
    const oldFolderPath = pathDir(migration.oldPath);
    const newFolderPath = pathDir(migration.newPath);
    if (!oldFolderPath || !newFolderPath || oldFolderPath === newFolderPath) continue;
    const key = `default\u0000${oldFolderPath}\u0000${newFolderPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ dataSourceId: "default", oldFolderPath, newFolderPath });
  }
  return result.sort((a, b) => b.oldFolderPath.length - a.oldFolderPath.length);
}

export function rewriteSharedDraftState(draftState, migrations, context = {}) {
  const lastActiveViews = migrateCollectionKeyMap(draftState?.lastActiveViews, migrations, "sharedDraft.lastActiveViews", context);
  const viewDrafts = migrateCollectionKeyMap(draftState?.viewDrafts, migrations, "sharedDraft.viewDrafts", context);
  const viewOrderDrafts = migrateCollectionKeyMap(draftState?.viewOrderDrafts, migrations, "sharedDraft.viewOrderDrafts", context);
  const structureDrafts = migrateCollectionKeyMap(draftState?.structureDrafts, migrations, "sharedDraft.structureDrafts", context);
  return {
    value: {
      lastActiveViews: lastActiveViews.value,
      viewDrafts: viewDrafts.value,
      viewOrderDrafts: viewOrderDrafts.value,
      structureDrafts: structureDrafts.value,
    },
    changed: lastActiveViews.changed || viewDrafts.changed || viewOrderDrafts.changed || structureDrafts.changed,
    report: mergeReports(lastActiveViews.report, viewDrafts.report, viewOrderDrafts.report, structureDrafts.report),
  };
}

function migrateCollectionKeyMap(object, migrations, surface, context = {}) {
  const next = {};
  const report = emptyReport();
  let changed = false;
  for (const [key, value] of Object.entries(object ?? {})) {
    const rewritten = rewriteCollectionConfigKey(key, migrations, context);
    if (!rewritten.changed) {
      next[key] = cloneValue(value);
      continue;
    }
    if (Object.hasOwn(object, rewritten.value)) {
      next[key] = cloneValue(value);
      report.conflicts.push({ surface, oldKey: key, newKey: rewritten.value, action: "kept-new" });
      continue;
    }
    next[rewritten.value] = cloneValue(value);
    changed = true;
    report.migrated.push({ surface, oldKey: key, newKey: rewritten.value });
  }
  return { value: next, changed: changed || report.conflicts.length > 0, report };
}

export function rewriteSharedViewsConfig(sharedViewsConfig, migrations, context = {}) {
  const collections = migrateCollectionKeyMap(sharedViewsConfig?.collections, migrations, "sharedViews.collections", context);
  return {
    value: {
      ...(sharedViewsConfig ?? {}),
      version: sharedViewsConfig?.version ?? 1,
      collections: collections.value,
    },
    changed: collections.changed,
    report: collections.report,
  };
}

export function rewriteViewLayouts(viewLayouts, migrations, context = {}) {
  return migrateCollectionKeyMap(viewLayouts, migrations, "viewLayouts", context);
}

export function applyProfilePathMigrations(profile, migrations, context = {}) {
  const fileOrder = rewriteFileOrder(profile?.fileOrder ?? [], migrations);
  const sidebarTree = rewriteSidebarTreePreferences(profile?.sidebarTree ?? {}, migrations);
  const drafts = rewriteSharedDraftState(profile ?? {}, migrations, context);
  const viewLayouts = rewriteViewLayouts(profile?.viewLayouts ?? {}, migrations, context);
  const collections = migrateCollectionKeyMap(profile?.collections ?? {}, migrations, "profile.collections", context);
  const report = mergeReports(fileOrder.report, sidebarTree.report, drafts.report, viewLayouts.report, collections.report);
  return {
    value: {
      ...(profile ?? {}),
      fileOrder: fileOrder.value,
      sidebarTree: sidebarTree.value,
      lastActiveViews: drafts.value.lastActiveViews,
      viewDrafts: drafts.value.viewDrafts,
      viewOrderDrafts: drafts.value.viewOrderDrafts,
      structureDrafts: drafts.value.structureDrafts,
      viewLayouts: viewLayouts.value,
      collections: collections.value,
    },
    changed: fileOrder.changed || sidebarTree.changed || drafts.changed || viewLayouts.changed || collections.changed,
    report,
  };
}

export function applyViewConfigPathMigrations(viewConfig, migrations) {
  const context = collectViewConfigContext(viewConfig, migrations);
  const fields = migrateObjectKeys(viewConfig?.fields ?? {}, rewriteFieldViewConfigKey, migrations, context, "viewConfig.fields");
  const titleFields = migrateObjectKeys(viewConfig?.titleFields ?? {}, rewriteCollectionConfigKey, migrations, context, "viewConfig.titleFields");
  const primaryKeys = migrateObjectKeys(viewConfig?.primaryKeys ?? {}, rewriteCollectionConfigKey, migrations, context, "viewConfig.primaryKeys");
  const relations = migrateRelations(viewConfig?.relations ?? {}, migrations, context);
  const backlinks = syncBacklinksWithRelations(relations.value, viewConfig?.backlinks ?? {});
  const backlinksChanged = JSON.stringify(backlinks) !== JSON.stringify(viewConfig?.backlinks ?? {});
  return {
    value: {
      ...(viewConfig ?? {}),
      fields: fields.value,
      titleFields: titleFields.value,
      primaryKeys: primaryKeys.value,
      relations: relations.value,
      backlinks,
    },
    changed: fields.changed || titleFields.changed || primaryKeys.changed || relations.changed || backlinksChanged,
    report: mergeReports(fields.report, titleFields.report, primaryKeys.report, relations.report, backlinksChanged ? {
      ...emptyReport(),
      migrated: [{ surface: "viewConfig.backlinks" }],
    } : null),
  };
}

export function applyPageContextPathMigrations(pageContext, migrations, context = {}) {
  const report = emptyReport();
  let changed = false;
  const selectedPathResult = rewritePath(pageContext?.selectedPath, migrations);
  const selectedPath = selectedPathResult.changed ? selectedPathResult.value : (pageContext?.selectedPath ?? null);
  if (selectedPathResult.changed) {
    changed = true;
    report.migrated.push({ surface: "pageContext.selectedPath", oldPath: pageContext.selectedPath, newPath: selectedPath });
  }

  const scrollByView = {};
  for (const [key, value] of Object.entries(pageContext?.scrollByView ?? {})) {
    const rewritten = rewritePageScrollContextKey(key, migrations, context);
    report.skipped.push(...rewritten.report.skipped);
    if (!rewritten.changed) {
      scrollByView[key] = cloneValue(value);
      continue;
    }
    if (Object.hasOwn(pageContext?.scrollByView ?? {}, rewritten.value)) {
      scrollByView[key] = cloneValue(value);
      report.conflicts.push({ surface: "pageContext.scrollByView", oldKey: key, newKey: rewritten.value, action: "kept-new" });
      continue;
    }
    scrollByView[rewritten.value] = cloneValue(value);
    changed = true;
    report.migrated.push(...rewritten.report.migrated);
  }

  return {
    value: {
      selectedPath,
      collectionPath: pageContext?.collectionPath ?? "$",
      scrollByView,
      expandedGroupId: typeof pageContext?.expandedGroupId === "string" && pageContext.expandedGroupId.trim()
        ? pageContext.expandedGroupId.trim()
        : null,
      lastActiveViewIdByGroupId: migrateStringRecord(pageContext?.lastActiveViewIdByGroupId),
    },
    changed: changed || report.conflicts.length > 0 || report.skipped.length > 0,
    report,
  };
}

function migrateStringRecord(value) {
  const next = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    const normalizedKey = String(key ?? "").trim();
    const normalizedValue = String(item ?? "").trim();
    if (!normalizedKey || !normalizedValue) continue;
    next[normalizedKey] = normalizedValue;
  }
  return next;
}

function collectViewConfigContext(viewConfig, migrations) {
  const collectionPathsByFile = {};
  for (const migration of normalizedMigrations(migrations)) collectionPathsByFile[migration.oldPath] = [];
  const add = (path, collectionPath) => {
    const normalizedPath = normalizePathForMigration(path);
    if (!normalizedPath || !collectionPathsByFile[normalizedPath] || !collectionPath) return;
    if (!collectionPathsByFile[normalizedPath].includes(collectionPath)) collectionPathsByFile[normalizedPath].push(collectionPath);
  };
  for (const key of Object.keys(viewConfig?.primaryKeys ?? {})) {
    for (const migration of normalizedMigrations(migrations)) {
      if (key.startsWith(`${migration.oldPath}:`)) add(migration.oldPath, key.slice(`${migration.oldPath}:`.length));
    }
  }
  for (const key of [...Object.keys(viewConfig?.fields ?? {}), ...Object.keys(viewConfig?.relations ?? {})]) {
    for (const migration of normalizedMigrations(migrations)) {
      if (!key.startsWith(`${migration.oldPath}:`)) continue;
      const rest = key.slice(`${migration.oldPath}:`.length);
      const index = rest.indexOf(":");
      if (index >= 0) add(migration.oldPath, rest.slice(0, index));
    }
  }
  return { collectionPathsByFile, viewIdsByCollectionKey: {} };
}

function migrateRelations(relations, migrations, context) {
  const keyed = migrateObjectKeys(relations, rewriteRelationKey, migrations, context, "viewConfig.relations");
  const next = {};
  let changed = keyed.changed;
  const report = keyed.report;
  for (const [key, config] of Object.entries(keyed.value)) {
    const nextConfig = { ...(config ?? {}) };
    const sourceFile = rewritePath(nextConfig.sourceFile, migrations);
    if (sourceFile.changed) {
      nextConfig.sourceFile = sourceFile.value;
      changed = true;
    }
    const targetFile = rewritePath(nextConfig.targetFile, migrations);
    if (targetFile.changed) {
      nextConfig.targetFile = targetFile.value;
      changed = true;
      report.migrated.push({ surface: "viewConfig.relations.targetFile", oldPath: config.targetFile, newPath: targetFile.value });
    }
    next[key] = nextConfig;
  }
  return { value: next, changed, report };
}

export function applyLocalPathMigrations(localStorage, migrations, context = {}) {
  const effectiveContext = collectLocalStorageRewriteContext(localStorage, migrations, context);
  const report = emptyReport();
  let changed = false;
  const keys = [];
  for (let index = 0; index < (localStorage?.length ?? 0); index += 1) {
    const key = localStorage.key(index);
    if (key) keys.push(key);
  }
  for (const key of keys) {
    const rewritten = rewriteLocalViewStorageKey(key, migrations, effectiveContext);
    report.skipped.push(...rewritten.report.skipped);
    if (!rewritten.changed) continue;
    if (localStorage.getItem(rewritten.value) != null) {
      report.conflicts.push({ surface: "localStorage", oldKey: key, newKey: rewritten.value, action: "kept-new" });
      continue;
    }
    localStorage.setItem(rewritten.value, localStorage.getItem(key));
    localStorage.removeItem(key);
    changed = true;
    report.migrated.push({ surface: "localStorage", oldKey: key, newKey: rewritten.value });
  }

  const fileOrderRaw = localStorage.getItem("data-editor:__file-order");
  if (fileOrderRaw != null) {
    const fileOrder = rewriteFileOrder(fileOrderRaw.split(","), migrations);
    if (fileOrder.changed) {
      localStorage.setItem("data-editor:__file-order", fileOrder.value.join(","));
      changed = true;
      report.migrated.push(...fileOrder.report.migrated);
    }
  }

  const sidebarRaw = localStorage.getItem("data-editor:__sidebar-tree-prefs");
  if (sidebarRaw) {
    try {
      const sidebarTree = rewriteSidebarTreePreferences(JSON.parse(sidebarRaw), migrations);
      if (sidebarTree.changed) {
        localStorage.setItem("data-editor:__sidebar-tree-prefs", JSON.stringify(sidebarTree.value));
        changed = true;
        report.migrated.push(...sidebarTree.report.migrated);
      }
    } catch {
      report.skipped.push({ surface: "localStorage.sidebarTree", key: "data-editor:__sidebar-tree-prefs", reason: "invalid-json" });
    }
  }

  const draftsRaw = localStorage.getItem("data-editor:shared-view-drafts");
  if (draftsRaw) {
    try {
      const drafts = rewriteSharedDraftState(JSON.parse(draftsRaw), migrations, effectiveContext);
      if (drafts.changed) {
        localStorage.setItem("data-editor:shared-view-drafts", JSON.stringify(drafts.value));
        changed = true;
        report.migrated.push(...drafts.report.migrated);
        report.conflicts.push(...drafts.report.conflicts);
      }
    } catch {
      report.skipped.push({ surface: "localStorage.sharedDrafts", key: "data-editor:shared-view-drafts", reason: "invalid-json" });
    }
  }

  return { value: localStorage, changed, report };
}

function collectLocalStorageRewriteContext(localStorage, migrations, context) {
  const next = {
    collectionPathsByFile: { ...(context?.collectionPathsByFile ?? {}) },
    viewIdsByCollectionKey: Object.fromEntries(
      Object.entries(context?.viewIdsByCollectionKey ?? {}).map(([key, value]) => [key, [...value]]),
    ),
  };
  const add = (record, key, value) => {
    if (!key || !value) return;
    record[key] ??= [];
    if (!record[key].includes(value)) record[key].push(value);
  };
  const isPayload = (parts) => {
    if (parts.length === 1) return parts[0] === "__order" || parts[0] === "__detail-order";
    return ["width", "hidden", "wrapped"].includes(parts.at(-1));
  };
  const keys = [];
  for (let index = 0; index < (localStorage?.length ?? 0); index += 1) {
    const key = localStorage.key(index);
    if (key) keys.push(key);
  }
  for (const migration of normalizedMigrations(migrations)) {
    const prefix = `data-editor:${migration.oldPath}:`;
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      const parts = key.slice(prefix.length).split(":");
      if (parts.at(-1) === "__detail-order" && parts.length >= 2) {
        const collectionPath = parts.slice(0, -1).join(":");
        if (collectionPath) add(next.collectionPathsByFile, migration.oldPath, collectionPath);
      }
      for (let viewIdIndex = 1; viewIdIndex < parts.length; viewIdIndex += 1) {
        const payloadParts = parts.slice(viewIdIndex + 1);
        if (!isPayload(payloadParts)) continue;
        const collectionPath = parts.slice(0, viewIdIndex).join(":");
        const encodedViewId = parts[viewIdIndex];
        if (!collectionPath || !encodedViewId) continue;
        add(next.collectionPathsByFile, migration.oldPath, collectionPath);
        const collectionKey = `${migration.oldPath}:${collectionPath}`;
        try {
          add(next.viewIdsByCollectionKey, collectionKey, decodeURIComponent(encodedViewId));
        } catch {
          add(next.viewIdsByCollectionKey, collectionKey, encodedViewId);
        }
      }
    }
  }
  return next;
}
