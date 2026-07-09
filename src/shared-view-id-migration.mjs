const neutralViewIdPattern = /^view-(\d+)$/;

function normalizeString(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function collectCollectionViews(items, output = []) {
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.kind === "group") {
      for (const leaf of Array.isArray(item.views) ? item.views : []) {
        if (leaf?.kind === "view" && leaf.view) output.push(leaf.view);
        else if (leaf?.view) output.push(leaf.view);
      }
      continue;
    }
    if (item?.kind === "view" && item.view) output.push(item.view);
    else if (item && typeof item === "object") output.push(item);
  }
  return output;
}

function nextNeutralViewId(usedIds) {
  let index = 1;
  let candidate = `view-${index}`;
  while (usedIds.has(candidate)) {
    index += 1;
    candidate = `view-${index}`;
  }
  return candidate;
}

export function buildSharedViewIdMaps(sharedViewsConfig) {
  const collections = sharedViewsConfig?.collections ?? {};
  const collectionIdMaps = {};
  for (const [collectionKey, collection] of Object.entries(collections)) {
    const views = collectCollectionViews(collection?.items);
    const usedIds = new Set(views.map((view) => normalizeString(view?.id)).filter(Boolean));
    const idMap = {};
    for (const view of views) {
      const currentId = normalizeString(view?.id);
      if (!currentId || currentId === "all" || neutralViewIdPattern.test(currentId)) continue;
      if (idMap[currentId]) continue;
      const nextId = nextNeutralViewId(usedIds);
      usedIds.add(nextId);
      idMap[currentId] = nextId;
    }
    if (Object.keys(idMap).length) collectionIdMaps[collectionKey] = idMap;
  }
  return collectionIdMaps;
}

function rewriteViewId(value, idMap) {
  const normalized = normalizeString(value);
  if (!normalized) return value;
  return idMap?.[normalized] ?? normalized;
}

function rewriteCollectionItems(items, idMap) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (item?.kind === "group") {
      return {
        ...item,
        views: (Array.isArray(item.views) ? item.views : []).map((leaf) => {
          if (leaf?.kind === "view" && leaf.view) {
            return {
              ...leaf,
              view: {
                ...leaf.view,
                id: rewriteViewId(leaf.view.id, idMap),
              },
            };
          }
          if (leaf?.view) {
            return {
              ...leaf,
              view: {
                ...leaf.view,
                id: rewriteViewId(leaf.view.id, idMap),
              },
            };
          }
          return leaf;
        }),
      };
    }
    if (item?.kind === "view" && item.view) {
      return {
        ...item,
        view: {
          ...item.view,
          id: rewriteViewId(item.view.id, idMap),
        },
      };
    }
    if (item && typeof item === "object") {
      return {
        ...item,
        id: rewriteViewId(item.id, idMap),
      };
    }
    return item;
  });
}

export function rewriteSharedViewsWithNeutralIds(sharedViewsConfig, collectionIdMaps) {
  const nextConfig = cloneJson(sharedViewsConfig) ?? {};
  nextConfig.collections ??= {};
  for (const [collectionKey, collection] of Object.entries(nextConfig.collections)) {
    const idMap = collectionIdMaps?.[collectionKey];
    if (!idMap) continue;
    collection.items = rewriteCollectionItems(collection.items, idMap);
    if (collection.defaultViewId !== undefined) {
      collection.defaultViewId = rewriteViewId(collection.defaultViewId, idMap);
    }
  }
  return nextConfig;
}

function rewriteStringRecordValues(record, idMap) {
  if (!record || typeof record !== "object") return record ?? {};
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, rewriteViewId(value, idMap)]),
  );
}

function rewriteNestedRecordKeys(record, idMap) {
  if (!record || typeof record !== "object") return record ?? {};
  const nextRecord = {};
  for (const [key, value] of Object.entries(record)) {
    nextRecord[rewriteViewId(key, idMap)] = value;
  }
  return nextRecord;
}

function rewriteViewOrderDrafts(record, idMap) {
  if (!record || typeof record !== "object") return record ?? {};
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map((viewId) => rewriteViewId(viewId, idMap)) : value,
    ]),
  );
}

function rewriteStructureDrafts(record, idMap) {
  if (!record || typeof record !== "object") return record ?? {};
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      value && typeof value === "object"
        ? {
          ...value,
          items: (Array.isArray(value.items) ? value.items : []).map((item) => {
            if (!item || typeof item !== "object") return item;
            if (item.kind === "view") return { ...item, viewId: rewriteViewId(item.viewId, idMap) };
            if (item.kind === "group") {
              return {
                ...item,
                viewIds: Array.isArray(item.viewIds) ? item.viewIds.map((viewId) => rewriteViewId(viewId, idMap)) : item.viewIds,
              };
            }
            return item;
          }),
        }
        : value,
    ]),
  );
}

export function rewriteProfileWithNeutralViewIds(profile, collectionIdMaps) {
  const nextProfile = cloneJson(profile) ?? {};
  const lastActiveViews = { ...(nextProfile.lastActiveViews ?? {}) };
  for (const [collectionKey, idMap] of Object.entries(collectionIdMaps ?? {})) {
    if (Object.hasOwn(lastActiveViews, collectionKey)) {
      lastActiveViews[collectionKey] = rewriteViewId(lastActiveViews[collectionKey], idMap);
    }
  }
  nextProfile.lastActiveViews = lastActiveViews;

  const viewLayouts = { ...(nextProfile.viewLayouts ?? {}) };
  for (const [collectionKey, idMap] of Object.entries(collectionIdMaps ?? {})) {
    if (!Object.hasOwn(viewLayouts, collectionKey)) continue;
    viewLayouts[collectionKey] = rewriteNestedRecordKeys(viewLayouts[collectionKey], idMap);
  }
  nextProfile.viewLayouts = viewLayouts;

  const viewDrafts = { ...(nextProfile.viewDrafts ?? {}) };
  for (const [collectionKey, idMap] of Object.entries(collectionIdMaps ?? {})) {
    if (!Object.hasOwn(viewDrafts, collectionKey)) continue;
    viewDrafts[collectionKey] = rewriteNestedRecordKeys(viewDrafts[collectionKey], idMap);
  }
  nextProfile.viewDrafts = viewDrafts;

  const viewOrderDrafts = { ...(nextProfile.viewOrderDrafts ?? {}) };
  for (const [collectionKey, idMap] of Object.entries(collectionIdMaps ?? {})) {
    if (!Object.hasOwn(viewOrderDrafts, collectionKey)) continue;
    viewOrderDrafts[collectionKey] = Array.isArray(viewOrderDrafts[collectionKey])
      ? viewOrderDrafts[collectionKey].map((viewId) => rewriteViewId(viewId, idMap))
      : viewOrderDrafts[collectionKey];
  }
  nextProfile.viewOrderDrafts = viewOrderDrafts;

  const structureDrafts = { ...(nextProfile.structureDrafts ?? {}) };
  for (const [collectionKey, idMap] of Object.entries(collectionIdMaps ?? {})) {
    if (!Object.hasOwn(structureDrafts, collectionKey)) continue;
    structureDrafts[collectionKey] = rewriteStructureDrafts({ [collectionKey]: structureDrafts[collectionKey] }, idMap)[collectionKey];
  }
  nextProfile.structureDrafts = structureDrafts;

  return nextProfile;
}

export function summarizeSharedViewIdMaps(collectionIdMaps) {
  return Object.fromEntries(
    Object.entries(collectionIdMaps ?? {}).map(([collectionKey, idMap]) => [collectionKey, Object.entries(idMap)]),
  );
}
