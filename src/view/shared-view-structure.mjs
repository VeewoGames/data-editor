import {
  normalizeCollectionView,
  normalizeSharedViewDraftState,
  normalizeSharedViewsConfig,
} from "./shared-view-normalize.mjs";

export function createViewGroupConfig({
  sharedViewsConfig,
  collectionKey,
  activeViewId,
  activeViewSnapshot,
}) {
  const normalizedConfig = normalizeSharedViewsConfig(sharedViewsConfig);
  const config = cloneSharedViewsConfig(normalizedConfig);
  const collection = ensureCollection(config, collectionKey);
  const views = flattenItems(collection.items);
  const snapshot = normalizeCollectionView(activeViewSnapshot ?? defaultAllView());
  const nextView = {
    ...snapshot,
    id: uniqueViewId(views, snapshot.id || "view"),
    name: uniqueViewName(views, "新视图", { preserveBase: true }),
  };
  const nextGroup = {
    kind: "group",
    id: uniqueGroupId(collection.items, "group"),
    name: uniqueGroupName(collection.items, "新分组"),
    views: [nextView],
  };
  collection.items = insertGroupAfter(collection.items, activeViewId, nextGroup);
  collection.defaultViewId = collection.defaultViewId ?? resolveDefaultViewIdFromItems(collection.items);
  return { config, group: nextGroup, view: nextView };
}

export function createViewInGroupConfig({
  sharedViewsConfig,
  collectionKey,
  groupId,
  activeViewSnapshot,
}) {
  const normalizedConfig = normalizeSharedViewsConfig(sharedViewsConfig);
  const config = cloneSharedViewsConfig(normalizedConfig);
  const collection = ensureCollection(config, collectionKey);
  const views = flattenItems(collection.items);
  const snapshot = normalizeCollectionView(activeViewSnapshot ?? defaultAllView());
  const nextView = {
    ...snapshot,
    id: uniqueViewId(views, snapshot.id || "view"),
    name: uniqueViewName(views, "新视图", { preserveBase: true }),
  };
  collection.items = appendViewToGroup(collection.items, groupId, nextView);
  return { config, view: nextView };
}

export function duplicateViewGroupConfig({
  sharedViewsConfig,
  collectionKey,
  groupId,
  resolvedTopLevelItems,
  resolvedGroupSnapshot,
}) {
  const normalizedConfig = normalizeSharedViewsConfig(sharedViewsConfig);
  const config = cloneSharedViewsConfig(normalizedConfig);
  const collection = ensureCollection(config, collectionKey);
  const topLevelItems = cloneResolvedTopLevelItems(resolvedTopLevelItems ?? []);
  const targetGroup = resolvedGroupSnapshot?.kind === "group"
    ? {
      kind: "group",
      id: resolvedGroupSnapshot.id,
      name: resolvedGroupSnapshot.name,
      views: resolvedGroupSnapshot.views.map((view) => ({ ...normalizeCollectionView(view) })),
    }
    : topLevelItems.find((item) => item.kind === "group" && item.id === groupId);
  if (!targetGroup || targetGroup.kind !== "group" || !targetGroup.views.length) {
    return {
      config,
      group: null,
      firstViewId: null,
      sourceToTargetViewIdMap: {},
    };
  }
  const existingViews = flattenItems(collection.items);
  const sourceToTargetViewIdMap = {};
  const duplicatedViews = targetGroup.views.map((view) => {
    const duplicatedView = {
      ...normalizeCollectionView(view),
      id: uniqueViewId([...existingViews, ...Object.values(sourceToTargetViewIdMap).map((id) => ({ id, name: "" }))], view.id || "view"),
      name: view.name,
    };
    sourceToTargetViewIdMap[view.id] = duplicatedView.id;
    existingViews.push(duplicatedView);
    return duplicatedView;
  });
  const duplicatedGroup = {
    kind: "group",
    id: uniqueGroupId(collection.items, targetGroup.id || "group"),
    name: uniqueCopyGroupName(collection.items, targetGroup.name || "新分组"),
    views: duplicatedViews,
  };
  collection.items = insertGroupAfterGroup(topLevelItems.length ? topLevelItems : collection.items, groupId, duplicatedGroup);
  collection.defaultViewId = collection.defaultViewId ?? resolveDefaultViewIdFromItems(collection.items);
  return {
    config,
    group: duplicatedGroup,
    firstViewId: duplicatedViews[0]?.id ?? null,
    sourceToTargetViewIdMap,
  };
}

export function applyStructureDraftToConfig(sharedViewsConfig, collectionKey, structureDraft) {
  const normalizedConfig = normalizeSharedViewsConfig(sharedViewsConfig);
  const config = cloneSharedViewsConfig(normalizedConfig);
  const collection = ensureCollection(config, collectionKey);
  if (!structureDraft?.items?.length) return config;
  collection.items = applyStructureDraft(collection.items, structureDraft.items);
  collection.defaultViewId = resolveDefaultViewIdFromItems(collection.items);
  return config;
}

export function renameViewGroupConfig({
  sharedViewsConfig,
  collectionKey,
  groupId,
  name,
}) {
  const normalizedConfig = normalizeSharedViewsConfig(sharedViewsConfig);
  const config = cloneSharedViewsConfig(normalizedConfig);
  const collection = ensureCollection(config, collectionKey);
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return config;
  collection.items = collection.items.map((item) => item.kind === "group" && item.id === groupId
    ? { ...item, name: trimmed, views: item.views.map((view) => ({ ...view })) }
    : item.kind === "group"
      ? { ...item, views: item.views.map((view) => ({ ...view })) }
      : { kind: "view", view: { ...item.view } });
  return config;
}

export function deleteViewGroupConfig({
  sharedViewsConfig,
  collectionKey,
  groupId,
}) {
  const normalizedConfig = normalizeSharedViewsConfig(sharedViewsConfig);
  const config = cloneSharedViewsConfig(normalizedConfig);
  const collection = ensureCollection(config, collectionKey);
  const nextItems = [];
  for (const item of collection.items) {
    if (item.kind !== "group" || item.id !== groupId) {
      nextItems.push(item.kind === "group"
        ? { ...item, views: item.views.map((view) => ({ ...view })) }
        : { kind: "view", view: { ...item.view } });
      continue;
    }
    for (const view of item.views) {
      nextItems.push({ kind: "view", view: { ...view } });
    }
  }
  collection.items = nextItems.length ? nextItems : [{ kind: "view", view: defaultAllView() }];
  collection.defaultViewId = resolveDefaultViewIdFromItems(collection.items);
  return config;
}

export function draftSharedViewStructure({
  draftState,
  collectionKey,
  topLevelItems,
  operation,
}) {
  const normalizedDraftState = normalizeSharedViewDraftState(draftState);
  const normalizedItems = cloneResolvedTopLevelItems(topLevelItems);
  const nextItems = applyStructureOperation(normalizedItems, operation);
  if (!nextItems) return normalizedDraftState;
  return {
    ...normalizedDraftState,
    viewDrafts: { ...normalizedDraftState.viewDrafts },
    viewOrderDrafts: Object.fromEntries(
      Object.entries(normalizedDraftState.viewOrderDrafts).filter(([key]) => key !== collectionKey),
    ),
    structureDrafts: {
      ...normalizedDraftState.structureDrafts,
      [collectionKey]: { items: serializeStructureDraftItems(nextItems) },
    },
  };
}

export function resolveSharedViewStructure({
  sharedViewsConfig,
  collectionKey,
  draftState,
  pageContext,
}) {
  const normalizedConfig = normalizeSharedViewsConfig(sharedViewsConfig);
  const normalizedDraftState = normalizeSharedViewDraftState(draftState);
  const collection = normalizedConfig.collections?.[collectionKey] ?? emptyCollection();
  const baseItems = collection.items.length ? cloneItems(collection.items) : [{ kind: "view", view: defaultAllView() }];
  const topLevelItems = resolveTopLevelItems(baseItems, normalizedDraftState, collectionKey);
  const flattenedViews = [];
  const viewsById = {};
  const parentGroupIdByViewId = {};
  for (const item of topLevelItems) {
    if (item.kind === "group") {
      for (const view of item.views) {
        flattenedViews.push(view);
        viewsById[view.id] = view;
        parentGroupIdByViewId[view.id] = item.id;
      }
      continue;
    }
    flattenedViews.push(item.view);
    viewsById[item.view.id] = item.view;
    parentGroupIdByViewId[item.view.id] = null;
  }
  if (!flattenedViews.length) {
    const fallback = defaultAllView();
    flattenedViews.push(fallback);
    viewsById[fallback.id] = fallback;
    parentGroupIdByViewId[fallback.id] = null;
  }
  const configuredActiveViewId = normalizedDraftState.lastActiveViews?.[collectionKey] ?? collection.defaultViewId ?? flattenedViews[0]?.id ?? null;
  const activeView = configuredActiveViewId && viewsById[configuredActiveViewId]
    ? viewsById[configuredActiveViewId]
    : flattenedViews[0] ?? null;
  const activeViewId = activeView?.id ?? null;
  const activeGroupId = activeViewId ? parentGroupIdByViewId[activeViewId] ?? null : null;
  const expandedGroupId = activeGroupId && topLevelItems.some((item) => item.kind === "group" && item.id === activeGroupId)
    ? activeGroupId
    : null;
  const lastActiveViewIdByGroupId = sanitizeLastActiveByGroup(topLevelItems, pageContext?.lastActiveViewIdByGroupId);
  return {
    topLevelItems,
    flattenedViews,
    activeView,
    activeViewId,
    activeGroupId,
    expandedGroupId,
    viewsById,
    parentGroupIdByViewId,
    lastActiveViewIdByGroupId,
  };
}

function resolveTopLevelItems(baseItems, draftState, collectionKey) {
  const structureDraft = draftState.structureDrafts?.[collectionKey];
  if (structureDraft?.items?.length) {
    return applyStructureDraft(baseItems, structureDraft.items);
  }
  const orderDraft = draftState.viewOrderDrafts?.[collectionKey];
  if (Array.isArray(orderDraft) && orderDraft.length && baseItems.every((item) => item.kind === "view")) {
    const orderedViews = applyFlatViewOrderDraft(baseItems.map((item) => item.view), orderDraft);
    return orderedViews.map((view) => ({ kind: "view", view }));
  }
  return baseItems;
}

function applyStructureOperation(topLevelItems, operation) {
  if (!operation || typeof operation !== "object") return null;
  const sourceViewId = typeof operation.sourceViewId === "string" ? operation.sourceViewId.trim() : "";
  if (!sourceViewId) return null;
  const extracted = extractViewFromResolvedItems(topLevelItems, sourceViewId);
  if (!extracted) return null;
  if (operation.type === "top-level") {
    const targetItemId = typeof operation.targetItemId === "string" ? operation.targetItemId.trim() : "";
    const placement = operation.placement === "before" ? "before" : operation.placement === "after" ? "after" : null;
    if (!targetItemId || !placement) return null;
    return insertResolvedViewAtTopLevel(extracted.items, extracted.view, targetItemId, placement);
  }
  if (operation.type === "group") {
    const groupId = typeof operation.groupId === "string" ? operation.groupId.trim() : "";
    const placement = operation.placement === "before" || operation.placement === "after" || operation.placement === "append"
      ? operation.placement
      : null;
    if (!groupId || !placement) return null;
    const targetViewId = typeof operation.targetViewId === "string" ? operation.targetViewId.trim() : "";
    return insertResolvedViewIntoGroup(extracted.items, extracted.view, groupId, placement, targetViewId || null);
  }
  return null;
}

function applyStructureDraft(baseItems, draftItems) {
  const viewById = new Map();
  const groupById = new Map();
  for (const item of baseItems) {
    if (item.kind === "group") {
      groupById.set(item.id, { id: item.id, name: item.name, views: item.views.map((view) => ({ ...view })) });
      for (const view of item.views) viewById.set(view.id, { ...view });
      continue;
    }
    viewById.set(item.view.id, { ...item.view });
  }
  const usedViewIds = new Set();
  const usedGroupIds = new Set();
  const nextItems = [];
  for (const item of draftItems) {
    if (item.kind === "view") {
      const view = viewById.get(item.viewId);
      if (!view || usedViewIds.has(view.id)) continue;
      usedViewIds.add(view.id);
      nextItems.push({ kind: "view", view });
      continue;
    }
    const existingGroup = groupById.get(item.groupId);
    const views = [];
    for (const viewId of item.viewIds ?? []) {
      const view = viewById.get(viewId);
      if (!view || usedViewIds.has(view.id)) continue;
      usedViewIds.add(view.id);
      views.push({ ...view });
    }
    if (!views.length || usedGroupIds.has(item.groupId)) continue;
    usedGroupIds.add(item.groupId);
    nextItems.push({
      kind: "group",
      id: item.groupId,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : existingGroup?.name ?? "未命名分组",
      views,
    });
  }
  for (const item of baseItems) {
    if (item.kind === "group") {
      const remainingViews = item.views.filter((view) => !usedViewIds.has(view.id)).map((view) => ({ ...view }));
      if (!remainingViews.length || usedGroupIds.has(item.id)) continue;
      usedGroupIds.add(item.id);
      for (const view of remainingViews) usedViewIds.add(view.id);
      nextItems.push({ kind: "group", id: item.id, name: item.name, views: remainingViews });
      continue;
    }
    if (usedViewIds.has(item.view.id)) continue;
    usedViewIds.add(item.view.id);
    nextItems.push({ kind: "view", view: { ...item.view } });
  }
  return nextItems.length ? nextItems : [{ kind: "view", view: defaultAllView() }];
}

function applyFlatViewOrderDraft(views, orderDraft) {
  const byId = new Map(views.map((view) => [view.id, view]));
  const ordered = [];
  const used = new Set();
  for (const id of orderDraft) {
    const view = byId.get(id);
    if (!view || used.has(id)) continue;
    ordered.push({ ...view });
    used.add(id);
  }
  for (const view of views) {
    if (used.has(view.id)) continue;
    ordered.push({ ...view });
  }
  return ordered;
}

function cloneItems(items) {
  return items.map((item) => {
    if (item.kind === "group") {
      return {
        kind: "group",
        id: item.id,
        name: item.name,
        views: item.views.map((view) => normalizeCollectionView(view)),
      };
    }
    return {
      kind: "view",
      view: normalizeCollectionView(item.view),
    };
  });
}

function cloneResolvedTopLevelItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (item?.kind === "group") {
      return {
        kind: "group",
        id: item.id,
        name: item.name,
        views: Array.isArray(item.views) ? item.views.map((view) => normalizeCollectionView(view)) : [],
      };
    }
    return {
      kind: "view",
      view: normalizeCollectionView(item?.view),
    };
  });
}

function extractViewFromResolvedItems(items, sourceViewId) {
  const nextItems = [];
  let sourceView = null;
  for (const item of items) {
    if (item.kind === "group") {
      const remainingViews = [];
      for (const view of item.views) {
        if (view.id === sourceViewId && !sourceView) {
          sourceView = { ...view };
          continue;
        }
        remainingViews.push({ ...view });
      }
      if (remainingViews.length) {
        nextItems.push({ kind: "group", id: item.id, name: item.name, views: remainingViews });
      }
      continue;
    }
    if (item.view.id === sourceViewId && !sourceView) {
      sourceView = { ...item.view };
      continue;
    }
    nextItems.push({ kind: "view", view: { ...item.view } });
  }
  return sourceView ? { items: nextItems, view: sourceView } : null;
}

function insertResolvedViewAtTopLevel(items, view, targetItemId, placement) {
  const nextItems = [];
  let inserted = false;
  for (const item of items) {
    const itemId = item.kind === "group" ? item.id : item.view.id;
    if (itemId === targetItemId && placement === "before" && !inserted) {
      nextItems.push({ kind: "view", view: { ...view } });
      inserted = true;
    }
    nextItems.push(item.kind === "group"
      ? { kind: "group", id: item.id, name: item.name, views: item.views.map((candidate) => ({ ...candidate })) }
      : { kind: "view", view: { ...item.view } });
    if (itemId === targetItemId && placement === "after" && !inserted) {
      nextItems.push({ kind: "view", view: { ...view } });
      inserted = true;
    }
  }
  if (!inserted) return null;
  return nextItems;
}

function insertResolvedViewIntoGroup(items, view, groupId, placement, targetViewId) {
  const nextItems = [];
  let inserted = false;
  for (const item of items) {
    if (item.kind !== "group" || item.id !== groupId) {
      nextItems.push(item.kind === "group"
        ? { kind: "group", id: item.id, name: item.name, views: item.views.map((candidate) => ({ ...candidate })) }
        : { kind: "view", view: { ...item.view } });
      continue;
    }
    const nextViews = [];
    if (placement === "append") {
      nextViews.push(...item.views.map((candidate) => ({ ...candidate })), { ...view });
      inserted = true;
    } else {
      for (const candidate of item.views) {
        if (candidate.id === targetViewId && placement === "before" && !inserted) {
          nextViews.push({ ...view });
          inserted = true;
        }
        nextViews.push({ ...candidate });
        if (candidate.id === targetViewId && placement === "after" && !inserted) {
          nextViews.push({ ...view });
          inserted = true;
        }
      }
    }
    nextItems.push({ kind: "group", id: item.id, name: item.name, views: nextViews });
  }
  if (!inserted) return null;
  return nextItems;
}

function serializeStructureDraftItems(items) {
  return items.map((item) => {
    if (item.kind === "group") {
      return {
        kind: "group",
        groupId: item.id,
        name: item.name,
        viewIds: item.views.map((view) => view.id),
      };
    }
    return {
      kind: "view",
      viewId: item.view.id,
    };
  });
}

function cloneSharedViewsConfig(normalizedConfig) {
  return {
    version: 1,
    collections: Object.fromEntries(Object.entries(normalizedConfig.collections ?? {}).map(([key, collection]) => [
      key,
      {
        defaultViewId: collection.defaultViewId,
        items: cloneItems(collection.items),
      },
    ])),
  };
}

function ensureCollection(config, collectionKey) {
  config.collections[collectionKey] ??= emptyCollection();
  if (!Array.isArray(config.collections[collectionKey].items) || !config.collections[collectionKey].items.length) {
    config.collections[collectionKey] = emptyCollection();
  }
  return config.collections[collectionKey];
}

function flattenItems(items) {
  const views = [];
  for (const item of items) {
    if (item.kind === "group") {
      for (const view of item.views) views.push(view);
      continue;
    }
    views.push(item.view);
  }
  return views;
}

function insertGroupAfter(items, activeViewId, group) {
  const nextItems = [];
  let inserted = false;
  for (const item of items) {
    nextItems.push(item.kind === "group"
      ? { ...item, views: item.views.map((view) => ({ ...view })) }
      : { kind: "view", view: { ...item.view } });
    const containsActive = item.kind === "group"
      ? item.views.some((view) => view.id === activeViewId)
      : item.view.id === activeViewId;
    if (containsActive) {
      nextItems.push({
        kind: "group",
        id: group.id,
        name: group.name,
        views: group.views.map((view) => ({ ...view })),
      });
      inserted = true;
    }
  }
  if (!inserted) {
    nextItems.push({
      kind: "group",
      id: group.id,
      name: group.name,
      views: group.views.map((view) => ({ ...view })),
    });
  }
  return nextItems;
}

function insertGroupAfterGroup(items, groupId, nextGroup) {
  const nextItems = [];
  let inserted = false;
  for (const item of items) {
    nextItems.push(item.kind === "group"
      ? { kind: "group", id: item.id, name: item.name, views: item.views.map((view) => ({ ...view })) }
      : { kind: "view", view: { ...item.view } });
    if (item.kind === "group" && item.id === groupId) {
      nextItems.push({
        kind: "group",
        id: nextGroup.id,
        name: nextGroup.name,
        views: nextGroup.views.map((view) => ({ ...view })),
      });
      inserted = true;
    }
  }
  if (!inserted) {
    nextItems.push({
      kind: "group",
      id: nextGroup.id,
      name: nextGroup.name,
      views: nextGroup.views.map((view) => ({ ...view })),
    });
  }
  return nextItems;
}

function appendViewToGroup(items, groupId, nextView) {
  return items.map((item) => {
    if (item.kind !== "group" || item.id !== groupId) {
      return item.kind === "group"
        ? { ...item, views: item.views.map((view) => ({ ...view })) }
        : { kind: "view", view: { ...item.view } };
    }
    return {
      ...item,
      views: [...item.views.map((view) => ({ ...view })), nextView],
    };
  });
}

function resolveDefaultViewIdFromItems(items) {
  const views = flattenItems(items);
  return views[0]?.id ?? null;
}

function uniqueViewId(views, baseId) {
  const normalizedBase = String(baseId).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "view";
  const existing = new Set(views.map((view) => view.id));
  let candidate = `${normalizedBase}-copy`;
  let index = 2;
  while (existing.has(candidate)) {
    candidate = `${normalizedBase}-copy-${index}`;
    index += 1;
  }
  return candidate;
}

function uniqueViewName(views, baseName, options = {}) {
  const trimmedBaseName = String(baseName).trim() || "View";
  const existing = new Set(views.map((view) => view.name));
  if (options.preserveBase && !existing.has(trimmedBaseName)) return trimmedBaseName;
  let candidate = options.preserveBase ? `${trimmedBaseName} 2` : `${trimmedBaseName} 副本`;
  let index = 3;
  while (existing.has(candidate)) {
    candidate = options.preserveBase ? `${trimmedBaseName} ${index}` : `${trimmedBaseName} 副本 ${index - 1}`;
    index += 1;
  }
  return candidate;
}

function uniqueGroupId(items, baseId) {
  const normalizedBase = String(baseId).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "group";
  const existing = new Set();
  for (const item of items) {
    if (item.kind === "group") {
      existing.add(item.id);
      for (const view of item.views) existing.add(view.id);
      continue;
    }
    existing.add(item.view.id);
  }
  let candidate = normalizedBase;
  let index = 2;
  while (existing.has(candidate)) {
    candidate = `${normalizedBase}-${index}`;
    index += 1;
  }
  return candidate;
}

function uniqueGroupName(items, baseName) {
  const trimmedBaseName = String(baseName).trim() || "新分组";
  const existing = new Set(items.filter((item) => item.kind === "group").map((item) => item.name));
  if (!existing.has(trimmedBaseName)) return trimmedBaseName;
  let candidate = `${trimmedBaseName} 2`;
  let index = 3;
  while (existing.has(candidate)) {
    candidate = `${trimmedBaseName} ${index}`;
    index += 1;
  }
  return candidate;
}

function uniqueCopyGroupName(items, sourceName) {
  const trimmedSourceName = String(sourceName).trim() || "新分组";
  const existing = new Set(items.filter((item) => item.kind === "group").map((item) => item.name));
  const baseName = `${trimmedSourceName} 副本`;
  if (!existing.has(baseName)) return baseName;
  let index = 2;
  let candidate = `${baseName} ${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `${baseName} ${index}`;
  }
  return candidate;
}

function emptyCollection() {
  return {
    defaultViewId: "all",
    items: [{ kind: "view", view: defaultAllView() }],
  };
}

function normalizeLastActiveByGroup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [groupId, viewId] of Object.entries(value)) {
    const normalizedGroupId = typeof groupId === "string" ? groupId.trim() : "";
    const normalizedViewId = typeof viewId === "string" ? viewId.trim() : "";
    if (!normalizedGroupId || !normalizedViewId) continue;
    result[normalizedGroupId] = normalizedViewId;
  }
  return result;
}

function sanitizeLastActiveByGroup(topLevelItems, value) {
  const normalized = normalizeLastActiveByGroup(value);
  if (!Object.keys(normalized).length) return {};
  const allowedViewIdsByGroupId = new Map();
  for (const item of topLevelItems) {
    if (item.kind !== "group") continue;
    allowedViewIdsByGroupId.set(item.id, new Set(item.views.map((view) => view.id)));
  }
  const result = {};
  for (const [groupId, viewId] of Object.entries(normalized)) {
    const allowedViewIds = allowedViewIdsByGroupId.get(groupId);
    if (!allowedViewIds?.has(viewId)) continue;
    result[groupId] = viewId;
  }
  return result;
}

function defaultAllView() {
  return normalizeCollectionView({
    id: "all",
    name: "全部",
    type: "table",
    query: "",
    filters: { topLevelRules: [], advancedRoot: null },
    sorts: [],
    hidden: [],
    wrapped: [],
    order: [],
    detailOrder: [],
    widths: {},
  });
}
