const filterOperators = new Set(["is", "is_not", "contains", "does_not_contain", "is_empty", "is_not_empty"]);
const sortDirections = new Set(["asc", "desc"]);

export function emptySharedViewsConfig() {
  return {
    version: 1,
    collections: {},
  };
}

export function normalizeCollectionView(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    id: normalizeString(source.id),
    name: normalizeString(source.name),
    type: "table",
    query: normalizeString(source.query),
    filters: normalizeFilterGroup(source.filters),
    sorts: normalizeSorts(source.sorts),
    hidden: normalizeStringArray(source.hidden),
    wrapped: normalizeStringArray(source.wrapped),
    order: normalizeStringArray(source.order),
    detailOrder: normalizeStringArray(source.detailOrder),
    widths: normalizeWidthRecord(source.widths),
  };
}

export function normalizeCollectionViewDraft(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const draft = {};
  if (Object.hasOwn(source, "query")) {
    draft.query = normalizeString(source.query);
  }
  if (Object.hasOwn(source, "filters")) {
    const filters = normalizeFilterGroup(source.filters);
    if (shouldKeepDraftFilterGroup(source.filters, filters)) draft.filters = filters;
  }
  if (Object.hasOwn(source, "sorts")) {
    const sorts = normalizeSorts(source.sorts);
    if (shouldKeepDraftArray(source.sorts, sorts)) draft.sorts = sorts;
  }
  for (const key of ["hidden", "wrapped", "order", "detailOrder"]) {
    if (!Object.hasOwn(source, key)) continue;
    const values = normalizeStringArray(source[key]);
    if (shouldKeepDraftArray(source[key], values)) draft[key] = values;
  }
  if (Object.hasOwn(source, "widths")) {
    const widths = normalizeWidthRecord(source.widths);
    if (shouldKeepDraftRecord(source.widths, widths)) draft.widths = widths;
  }
  return draft;
}

export function emptySharedViewDraftState() {
  return {
    lastActiveViews: {},
    viewDrafts: {},
    viewOrderDrafts: {},
  };
}

export function normalizeSharedViewDraftState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptySharedViewDraftState();
  return {
    lastActiveViews: normalizeStringRecord(value.lastActiveViews),
    viewDrafts: normalizeViewDrafts(value.viewDrafts),
    viewOrderDrafts: normalizeViewOrderDrafts(value.viewOrderDrafts),
  };
}

export function normalizeSharedViewsConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptySharedViewsConfig();
  const collections = {};
  const rawCollections = value.collections;
  if (rawCollections && typeof rawCollections === "object" && !Array.isArray(rawCollections)) {
    for (const [collectionKey, collectionConfig] of Object.entries(rawCollections)) {
      const normalizedKey = normalizeString(collectionKey);
      if (!normalizedKey || !collectionConfig || typeof collectionConfig !== "object" || Array.isArray(collectionConfig)) continue;
      const views = Array.isArray(collectionConfig.views)
        ? collectionConfig.views
          .filter((view) => view && typeof view === "object" && !Array.isArray(view))
          .map((view) => normalizeCollectionView(view))
        : [];
      collections[normalizedKey] = {
        defaultViewId: normalizeNullableString(collectionConfig.defaultViewId),
        views,
      };
    }
  }
  return {
    version: 1,
    collections,
  };
}

function normalizeFilterGroup(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    op: "and",
    rules: normalizeFilterRules(source.rules),
  };
}

function normalizeFilterRules(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = normalizeString(item.id);
    const field = normalizeString(item.field);
    const operator = normalizeString(item.operator);
    if (!id || !field || !filterOperators.has(operator)) continue;
    const rule = { id, field, operator };
    if ("value" in item) rule.value = item.value;
    result.push(rule);
  }
  return result;
}

function normalizeSorts(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = normalizeString(item.id);
    const field = normalizeString(item.field);
    const direction = normalizeString(item.direction);
    if (!id || !field || !sortDirections.has(direction)) continue;
    result.push({ id, field, direction });
  }
  return result;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const normalized = normalizeString(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeStringRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = normalizeString(key);
    const normalizedValue = normalizeString(item);
    if (!normalizedKey || !normalizedValue) continue;
    result[normalizedKey] = normalizedValue;
  }
  return result;
}

function normalizeViewDrafts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [collectionKey, rawViews] of Object.entries(value)) {
    const normalizedCollectionKey = normalizeString(collectionKey);
    if (!normalizedCollectionKey || !rawViews || typeof rawViews !== "object" || Array.isArray(rawViews)) continue;
    const drafts = {};
    for (const [viewId, rawDraft] of Object.entries(rawViews)) {
      const normalizedViewId = normalizeString(viewId);
      if (!normalizedViewId || !rawDraft || typeof rawDraft !== "object" || Array.isArray(rawDraft)) continue;
      const draft = normalizeCollectionViewDraft(rawDraft);
      if (Object.keys(draft).length) drafts[normalizedViewId] = draft;
    }
    if (Object.keys(drafts).length) result[normalizedCollectionKey] = drafts;
  }
  return result;
}

function normalizeViewOrderDrafts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [collectionKey, rawOrder] of Object.entries(value)) {
    const normalizedCollectionKey = normalizeString(collectionKey);
    if (!normalizedCollectionKey) continue;
    const order = normalizeStringArray(rawOrder);
    if (order.length) result[normalizedCollectionKey] = order;
  }
  return result;
}

function normalizeWidthRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = normalizeString(key);
    const rounded = Number.isFinite(item) ? Math.round(Number(item)) : 0;
    if (!normalizedKey || rounded <= 0) continue;
    result[normalizedKey] = rounded;
  }
  return result;
}

function shouldKeepDraftFilterGroup(rawValue, normalizedValue) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return false;
  const rawRules = Array.isArray(rawValue.rules) ? rawValue.rules : [];
  return rawRules.length === 0 || normalizedValue.rules.length > 0;
}

function shouldKeepDraftArray(rawValue, normalizedValue) {
  if (!Array.isArray(rawValue)) return false;
  return rawValue.length === 0 || normalizedValue.length > 0;
}

function shouldKeepDraftRecord(rawValue, normalizedValue) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return false;
  return Object.keys(rawValue).length === 0 || Object.keys(normalizedValue).length > 0;
}

function normalizeNullableString(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
