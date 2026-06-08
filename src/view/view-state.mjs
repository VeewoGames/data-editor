import {
  normalizeCollectionView,
  normalizeCollectionViewDraft,
  normalizeSharedViewDraftState,
  normalizeSharedViewsConfig,
} from "./shared-view-normalize.mjs";

export function collectionConfigKey(path, collectionPath) {
  return `${path}:${collectionPath}`;
}

export function resolveCollectionViews(sharedViewsConfig, collectionKey) {
  const views = sharedViewsConfig?.collections?.[collectionKey]?.views;
  if (!Array.isArray(views) || views.length === 0) return [defaultAllView()];
  return views.map((view) => normalizeCollectionView(view));
}

export function resolveDefaultViewId(sharedViewsConfig, collectionKey) {
  const views = resolveCollectionViews(sharedViewsConfig, collectionKey);
  if (!views.length) return null;
  const configuredDefault = sharedViewsConfig?.collections?.[collectionKey]?.defaultViewId;
  return views.some((view) => view.id === configuredDefault) ? configuredDefault : views[0].id;
}

export function mergeSharedViewWithDraft(sharedView, draft) {
  return {
    ...sharedView,
    ...normalizeCollectionViewDraft(draft),
  };
}

export function applyViewOrderDraft(views, orderDraft) {
  if (!Array.isArray(orderDraft) || !orderDraft.length) return views;
  const byId = new Map(views.map((view) => [view.id, view]));
  const ordered = [];
  const used = new Set();
  for (const id of orderDraft) {
    if (!byId.has(id) || used.has(id)) continue;
    ordered.push(byId.get(id));
    used.add(id);
  }
  for (const view of views) {
    if (used.has(view.id)) continue;
    ordered.push(view);
  }
  return ordered;
}

export function resolveActiveView(views, lastActiveViewId, defaultViewId) {
  if (!Array.isArray(views) || !views.length) return null;
  return views.find((view) => view.id === lastActiveViewId)
    ?? views.find((view) => view.id === defaultViewId)
    ?? views[0];
}

export function hasViewDraft(draftState, collectionKey, viewId) {
  return Boolean(
    draftState?.viewDrafts?.[collectionKey]?.[viewId]
      || draftState?.viewOrderDrafts?.[collectionKey]?.length,
  );
}

export function resetActiveSharedViewDraft(draftState, collectionKey, viewId) {
  const next = clearViewDraft(draftState, collectionKey, viewId);
  return {
    draftState: next,
    dirty: hasAnyViewDraft(next),
  };
}

export function createSharedViewConfig(sharedViewsConfig, collectionKey, activeViewId, activeViewSnapshot, options = {}) {
  const config = cloneSharedViewsConfig(sharedViewsConfig);
  const collection = ensureSharedCollection(config, collectionKey);
  const views = collection.views.length ? collection.views : [defaultAllView()];
  const activeIndex = Math.max(0, views.findIndex((view) => view.id === activeViewId));
  const snapshot = normalizeCollectionView(activeViewSnapshot ?? views[activeIndex] ?? defaultAllView());
  const duplicateNameBase = typeof options.nameBase === "string" ? options.nameBase.trim() : "";
  const nextView = {
    ...snapshot,
    id: uniqueViewId(views, snapshot.id || "view"),
    name: uniqueViewName(views, duplicateNameBase || snapshot.name || "View", { preserveBase: Boolean(duplicateNameBase) }),
  };
  const nextViews = [...views];
  nextViews.splice(activeIndex + 1, 0, nextView);
  collection.views = nextViews;
  collection.defaultViewId = resolveDefaultFromCollection(collection);
  return { config, view: nextView };
}

export function renameSharedViewConfig(sharedViewsConfig, collectionKey, viewId, name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return cloneSharedViewsConfig(sharedViewsConfig);
  const config = cloneSharedViewsConfig(sharedViewsConfig);
  const collection = ensureSharedCollection(config, collectionKey);
  collection.views = collection.views.map((view) => view.id === viewId ? { ...view, name: trimmed } : view);
  return config;
}

export function deleteSharedViewConfig(sharedViewsConfig, draftState, collectionKey, viewId) {
  const config = cloneSharedViewsConfig(sharedViewsConfig);
  const normalizedDraftState = normalizeSharedViewDraftState(draftState);
  const collection = ensureSharedCollection(config, collectionKey);
  const views = collection.views.length ? collection.views : [defaultAllView()];
  if (views.length <= 1) {
    return {
      config: sharedViewsConfig,
      draftState,
      deleted: false,
      nextActiveViewId: views[0]?.id ?? viewId,
    };
  }
  const deleteIndex = views.findIndex((view) => view.id === viewId);
  if (deleteIndex < 0) {
    return {
      config,
      draftState: normalizedDraftState,
      deleted: false,
      nextActiveViewId: views[0]?.id ?? null,
    };
  }
  const nextViews = views.filter((view) => view.id !== viewId);
  const replacement = nextViews[Math.min(deleteIndex, nextViews.length - 1)] ?? nextViews[0];
  const currentActiveViewId = normalizedDraftState.lastActiveViews[collectionKey];
  const nextActiveViewId = currentActiveViewId && currentActiveViewId !== viewId && nextViews.some((view) => view.id === currentActiveViewId)
    ? currentActiveViewId
    : replacement.id;
  collection.views = nextViews;
  collection.defaultViewId = collection.defaultViewId === viewId ? nextViews[0].id : resolveDefaultFromCollection(collection);
  const nextDraftState = clearViewDraft(normalizedDraftState, collectionKey, viewId);
  nextDraftState.lastActiveViews = { ...nextDraftState.lastActiveViews, [collectionKey]: nextActiveViewId };
  return {
    config,
    draftState: nextDraftState,
    deleted: true,
    nextActiveViewId,
  };
}

export function draftSharedViewOrder(draftState, collectionKey, views, viewIds) {
  const next = normalizeSharedViewDraftState(draftState);
  const normalizedViews = Array.isArray(views) ? views : [];
  next.viewOrderDrafts = {
    ...next.viewOrderDrafts,
    [collectionKey]: normalizeViewOrder(normalizedViews, viewIds),
  };
  return next;
}

export function saveSharedViewDraftsToConfig(sharedViewsConfig, draftState, collectionKey, activeViewId) {
  const config = cloneSharedViewsConfig(sharedViewsConfig);
  const normalizedDraftState = normalizeSharedViewDraftState(draftState);
  const collection = ensureSharedCollection(config, collectionKey);
  const views = collection.views.length ? collection.views : [defaultAllView()];
  const activeDraft = normalizedDraftState.viewDrafts[collectionKey]?.[activeViewId];
  const draftedViews = views.map((view) => view.id === activeViewId ? mergeSharedViewWithDraft(view, activeDraft) : view);
  collection.views = applyViewOrderDraft(draftedViews, normalizedDraftState.viewOrderDrafts[collectionKey]);
  collection.defaultViewId = resolveDefaultFromCollection(collection);
  const nextDraftState = {
    ...normalizedDraftState,
    viewDrafts: { ...normalizedDraftState.viewDrafts },
    viewOrderDrafts: { ...normalizedDraftState.viewOrderDrafts },
  };
  if (nextDraftState.viewDrafts[collectionKey]) {
    const nextCollectionDrafts = { ...nextDraftState.viewDrafts[collectionKey] };
    delete nextCollectionDrafts[activeViewId];
    if (Object.keys(nextCollectionDrafts).length) {
      nextDraftState.viewDrafts[collectionKey] = nextCollectionDrafts;
    } else {
      delete nextDraftState.viewDrafts[collectionKey];
    }
  }
  delete nextDraftState.viewOrderDrafts[collectionKey];
  return {
    config,
    draftState: nextDraftState,
    dirty: hasAnyViewDraft(nextDraftState),
  };
}

export function clearViewDraft(draftState, collectionKey, viewId) {
  const next = {
    ...draftState,
    viewDrafts: { ...(draftState?.viewDrafts ?? {}) },
    viewOrderDrafts: { ...(draftState?.viewOrderDrafts ?? {}) },
  };

  if (next.viewDrafts[collectionKey]) {
    const nextCollectionDrafts = { ...next.viewDrafts[collectionKey] };
    delete nextCollectionDrafts[viewId];
    if (Object.keys(nextCollectionDrafts).length) {
      next.viewDrafts[collectionKey] = nextCollectionDrafts;
    } else {
      delete next.viewDrafts[collectionKey];
    }
  }
  delete next.viewOrderDrafts[collectionKey];
  return next;
}

function hasAnyViewDraft(draftState) {
  return Object.values(draftState?.viewDrafts ?? {}).some((views) => Object.keys(views ?? {}).length > 0)
    || Object.values(draftState?.viewOrderDrafts ?? {}).some((order) => Array.isArray(order) && order.length > 0);
}

function cloneSharedViewsConfig(sharedViewsConfig) {
  const normalized = normalizeSharedViewsConfig(sharedViewsConfig);
  return {
    version: 1,
    collections: Object.fromEntries(Object.entries(normalized.collections).map(([key, collection]) => [
      key,
      {
        defaultViewId: collection.defaultViewId,
        views: collection.views.map((view) => ({ ...view })),
      },
    ])),
  };
}

function ensureSharedCollection(config, collectionKey) {
  config.collections[collectionKey] ??= { views: [defaultAllView()], defaultViewId: "all" };
  if (!config.collections[collectionKey].views.length) config.collections[collectionKey].views = [defaultAllView()];
  config.collections[collectionKey].defaultViewId = resolveDefaultFromCollection(config.collections[collectionKey]);
  return config.collections[collectionKey];
}

function resolveDefaultFromCollection(collection) {
  if (!collection.views.length) return null;
  return collection.views.some((view) => view.id === collection.defaultViewId) ? collection.defaultViewId : collection.views[0].id;
}

function normalizeViewOrder(views, viewIds) {
  const byId = new Set(views.map((view) => view.id));
  const used = new Set();
  const order = [];
  for (const id of Array.isArray(viewIds) ? viewIds : []) {
    if (!byId.has(id) || used.has(id)) continue;
    order.push(id);
    used.add(id);
  }
  for (const view of views) {
    if (used.has(view.id)) continue;
    order.push(view.id);
  }
  return order;
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
  let candidate = options.preserveBase ? `${trimmedBaseName} 2` : `${trimmedBaseName} copy`;
  let index = 3;
  while (existing.has(candidate)) {
    candidate = options.preserveBase ? `${trimmedBaseName} ${index}` : `${trimmedBaseName} copy ${index - 1}`;
    index += 1;
  }
  return candidate;
}

function defaultAllView() {
  return {
    id: "all",
    name: "全部",
    type: "table",
    query: "",
    filters: { op: "and", rules: [] },
    sorts: [],
    hidden: [],
    wrapped: [],
    order: [],
    detailOrder: [],
    widths: {},
  };
}
