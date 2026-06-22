import {
  normalizeCollectionView,
  normalizeCollectionViewDraft,
  normalizeSharedViewLeaf,
  normalizeSharedViewDraftState,
  normalizeSharedViewsConfig,
} from "./shared-view-normalize.mjs";
import { applyStructureDraftToConfig } from "./shared-view-structure.mjs";

export function collectionConfigKey(path, collectionPath) {
  return `${path}:${collectionPath}`;
}

export function resolveCollectionViews(sharedViewsConfig, collectionKey) {
  const collection = normalizeSharedViewsConfig(sharedViewsConfig)?.collections?.[collectionKey];
  const views = listCollectionViews(collection);
  if (!views.length) return [defaultAllView()];
  return views;
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
      || draftState?.viewOrderDrafts?.[collectionKey]?.length
      || draftState?.structureDrafts?.[collectionKey]?.items?.length,
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
  const views = listCollectionViews(collection);
  const activeIndex = Math.max(0, views.findIndex((view) => view.id === activeViewId));
  const snapshot = normalizeCollectionView(activeViewSnapshot ?? views[activeIndex] ?? defaultAllView());
  const duplicateNameBase = typeof options.nameBase === "string" ? options.nameBase.trim() : "";
  const nextView = {
    ...snapshot,
    id: uniqueViewId(views, snapshot.id || "view"),
    name: uniqueViewName(views, duplicateNameBase || snapshot.name || "View", { preserveBase: Boolean(duplicateNameBase) }),
  };
  collection.items = insertViewAfter(collection.items, activeViewId, nextView);
  collection.defaultViewId = resolveDefaultFromCollection(collection);
  return { config, view: nextView };
}

export function renameSharedViewConfig(sharedViewsConfig, collectionKey, viewId, name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return cloneSharedViewsConfig(sharedViewsConfig);
  const config = cloneSharedViewsConfig(sharedViewsConfig);
  const collection = ensureSharedCollection(config, collectionKey);
  collection.items = renameViewInItems(collection.items, viewId, trimmed);
  return config;
}

export function updateSharedViewIconConfig(sharedViewsConfig, collectionKey, viewId, icon) {
  const config = cloneSharedViewsConfig(sharedViewsConfig);
  const collection = ensureSharedCollection(config, collectionKey);
  collection.items = updateViewIconInItems(collection.items, viewId, icon);
  return config;
}

export function deleteSharedViewConfig(sharedViewsConfig, draftState, collectionKey, viewId) {
  const config = cloneSharedViewsConfig(sharedViewsConfig);
  const normalizedDraftState = normalizeSharedViewDraftState(draftState);
  const collection = ensureSharedCollection(config, collectionKey);
  const views = listCollectionViews(collection);
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
  collection.items = deleteViewFromItems(collection.items, viewId);
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
  const normalizedDraftState = normalizeSharedViewDraftState(draftState);
  const config = normalizedDraftState.structureDrafts?.[collectionKey]?.items?.length
    ? applyStructureDraftToConfig(sharedViewsConfig, collectionKey, normalizedDraftState.structureDrafts[collectionKey])
    : cloneSharedViewsConfig(sharedViewsConfig);
  const collection = ensureSharedCollection(config, collectionKey);
  const activeDraft = normalizedDraftState.viewDrafts[collectionKey]?.[activeViewId];
  collection.items = applyDraftsToItems(
    collection.items,
    activeViewId,
    activeDraft,
    normalizedDraftState.viewOrderDrafts[collectionKey],
  );
  collection.defaultViewId = resolveDefaultFromCollection(collection);
  const nextDraftState = {
    ...normalizedDraftState,
    viewDrafts: { ...normalizedDraftState.viewDrafts },
    viewOrderDrafts: { ...normalizedDraftState.viewOrderDrafts },
    structureDrafts: { ...normalizedDraftState.structureDrafts },
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
  delete nextDraftState.structureDrafts[collectionKey];
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
    structureDrafts: { ...(draftState?.structureDrafts ?? {}) },
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
  delete next.structureDrafts[collectionKey];
  return next;
}

function hasAnyViewDraft(draftState) {
  return Object.values(draftState?.viewDrafts ?? {}).some((views) => Object.keys(views ?? {}).length > 0)
    || Object.values(draftState?.viewOrderDrafts ?? {}).some((order) => Array.isArray(order) && order.length > 0)
    || Object.values(draftState?.structureDrafts ?? {}).some((draft) => Array.isArray(draft?.items) && draft.items.length > 0);
}

function cloneSharedViewsConfig(sharedViewsConfig) {
  const normalized = normalizeSharedViewsConfig(sharedViewsConfig);
  return {
    version: 1,
    collections: Object.fromEntries(Object.entries(normalized.collections).map(([key, collection]) => [
      key,
      {
        defaultViewId: collection.defaultViewId,
        items: cloneCollectionItems(collection.items),
      },
    ])),
  };
}

function ensureSharedCollection(config, collectionKey) {
  config.collections[collectionKey] ??= { items: [{ kind: "view", icon: "borderAll", view: defaultAllView() }], defaultViewId: "all" };
  if (!Array.isArray(config.collections[collectionKey].items) || !config.collections[collectionKey].items.length) {
    config.collections[collectionKey].items = [{ kind: "view", icon: "borderAll", view: defaultAllView() }];
  }
  config.collections[collectionKey].defaultViewId = resolveDefaultFromCollection(config.collections[collectionKey]);
  return config.collections[collectionKey];
}

function resolveDefaultFromCollection(collection) {
  const views = listCollectionViews(collection);
  if (!views.length) return null;
  return views.some((view) => view.id === collection.defaultViewId) ? collection.defaultViewId : views[0].id;
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

function listCollectionViews(collection) {
  if (!collection || typeof collection !== "object") return [];
  if (Array.isArray(collection.items)) {
    const views = [];
    for (const item of collection.items) {
      if (item?.kind === "group") {
        for (const view of item.views ?? []) {
          views.push(normalizeCollectionView(view.view));
        }
        continue;
      }
      const rawView = item?.kind === "view" ? item.view : item;
      views.push(normalizeCollectionView(rawView));
    }
    return views.filter((view) => view.id && view.name);
  }
  if (Array.isArray(collection.views)) {
    return collection.views.map((view) => normalizeCollectionView(view)).filter((view) => view.id && view.name);
  }
  return [];
}

function cloneCollectionItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (item?.kind === "group") {
      return {
        kind: "group",
        id: item.id,
        name: item.name,
        views: Array.isArray(item.views) ? item.views.map((view) => normalizeSharedViewLeaf(view)) : [],
      };
    }
    return {
      kind: "view",
      ...(item?.kind === "view" && typeof item.icon === "string" ? { icon: item.icon } : { icon: "borderAll" }),
      view: { ...(item?.kind === "view" ? item.view : item) },
    };
  });
}

function insertViewAfter(items, activeViewId, nextView) {
  const nextItems = [];
  let inserted = false;
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.kind === "group") {
      const views = [];
      for (const view of item.views ?? []) {
        views.push(normalizeSharedViewLeaf(view));
        if (view.view.id === activeViewId) {
          views.push({ kind: "view", icon: view.icon ?? "borderAll", view: nextView });
          inserted = true;
        }
      }
      nextItems.push({ ...item, views });
      continue;
    }
    const rawView = item?.kind === "view" ? item.view : item;
    nextItems.push({ kind: "view", icon: item?.kind === "view" ? item.icon ?? "borderAll" : "borderAll", view: { ...rawView } });
    if (rawView?.id === activeViewId) {
      nextItems.push({ kind: "view", icon: item?.kind === "view" ? item.icon ?? "borderAll" : "borderAll", view: nextView });
      inserted = true;
    }
  }
  if (!inserted) nextItems.push({ kind: "view", icon: "borderAll", view: nextView });
  return nextItems;
}

function renameViewInItems(items, viewId, name) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (item?.kind === "group") {
      return {
        ...item,
        views: (item.views ?? []).map((view) => view.view.id === viewId ? { ...view, view: { ...view.view, name } } : normalizeSharedViewLeaf(view)),
      };
    }
    const rawView = item?.kind === "view" ? item.view : item;
    return {
      kind: "view",
      view: rawView?.id === viewId ? { ...rawView, name } : { ...rawView },
    };
  });
}

function updateViewIconInItems(items, viewId, icon) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (item?.kind === "group") {
      return {
        ...item,
        views: (item.views ?? []).map((view) => view.view.id === viewId ? { ...view, icon } : normalizeSharedViewLeaf(view)),
      };
    }
    const rawView = item?.kind === "view" ? item.view : item;
    return {
      kind: "view",
      icon: rawView?.id === viewId ? icon : item?.kind === "view" ? item.icon ?? "borderAll" : "borderAll",
      view: { ...rawView },
    };
  });
}

function deleteViewFromItems(items, viewId) {
  const nextItems = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.kind === "group") {
      const views = (item.views ?? []).filter((view) => view.view.id !== viewId).map((view) => normalizeSharedViewLeaf(view));
      if (views.length) nextItems.push({ ...item, views });
      continue;
    }
    const rawView = item?.kind === "view" ? item.view : item;
    if (rawView?.id === viewId) continue;
    nextItems.push({ kind: "view", view: { ...rawView } });
  }
  return nextItems;
}

function applyDraftsToItems(items, activeViewId, activeDraft, orderDraft) {
  const nextItems = (Array.isArray(items) ? items : []).map((item) => {
    if (item?.kind === "group") {
      return {
        ...item,
        views: (item.views ?? []).map((view) => {
          if (view.view.id !== activeViewId) return normalizeSharedViewLeaf(view);
          return {
            ...view,
            view: mergeSharedViewWithDraft(view.view, activeDraft),
          };
        }),
      };
    }
    const rawView = item?.kind === "view" ? item.view : item;
    return {
      kind: "view",
      icon: item?.kind === "view" ? item.icon ?? "borderAll" : "borderAll",
      view: rawView?.id === activeViewId ? mergeSharedViewWithDraft(rawView, activeDraft) : { ...rawView },
    };
  });
  if (!Array.isArray(orderDraft) || !orderDraft.length) return nextItems;
  if (nextItems.some((item) => item?.kind === "group")) return nextItems;
  const orderedViews = applyViewOrderDraft(nextItems.map((item) => item.view), orderDraft);
  return orderedViews.map((view) => ({ kind: "view", icon: "borderAll", view }));
}

function defaultAllView() {
  return {
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
  };
}
