const filterOperators = new Set(["is", "is_not", "contains", "does_not_contain", "is_empty", "is_not_empty"]);
const sortDirections = new Set(["asc", "desc"]);
export const sharedViewIconIds = new Set([
  "borderAll",
  "folder",
  "folders",
  "folderOpen",
  "bookmark",
  "bookmarkStack",
  "book",
  "star",
  "stars",
  "search",
  "settings",
  "mapPin",
  "json",
  "edit",
  "list",
  "listCheck",
  "listDetails",
  "calendar",
  "calendarEvent",
  "clock",
  "flag",
  "bell",
  "briefcase",
  "tag",
  "table",
  "layoutGrid",
  "database",
  "file",
  "files",
  "fileText",
  "fileCode",
  "fileAnalytics",
  "tags",
  "filter",
  "filters",
  "home",
  "home2",
  "building",
  "school",
  "hospital",
  "heart",
  "mug",
  "bottle",
  "apple",
  "pizza",
  "salad",
  "car",
  "bus",
  "bike",
  "motorbike",
  "plane",
  "shoppingCart",
  "gift",
  "mail",
  "phone",
  "camera",
  "world",
  "cloud",
  "bed",
  "bath",
  "bulb",
  "gamepad",
  "gamepad2",
  "gamepad3",
  "puzzle",
  "cards",
  "layoutCards",
  "dice",
  "chess",
  "chessKing",
  "chessQueen",
  "chessKnight",
  "chessBishop",
  "chessRook",
  "crown",
  "sparkles",
  "sparkles2",
  "shield",
  "shieldCheck",
  "shieldCheckered",
  "shieldHalf",
  "shieldLock",
  "bolt",
  "flame",
  "bomb",
  "sword",
  "swords",
  "axe",
  "hammer",
  "wand",
  "helmet",
  "backpack",
  "archeryArrow",
  "shieldBolt",
  "targetArrow",
  "arrowBigRight",
  "arrowBigLeft",
  "arrowBigUp",
  "arrowBigDown",
  "spider",
  "biohazard",
  "radioactive",
  "bone",
  "bug",
  "alertCircle",
  "alertHexagon",
  "alertOctagon",
  "alertSquare",
  "alertSquareRounded",
  "alertTriangle",
  "bow",
  "blade",
  "flask",
  "flask2",
  "cross",
  "medicalCross",
  "heartBroken",
  "droplet",
  "dropletHalf",
  "dropletHalf2",
  "droplets",
  "sunHigh",
  "sunLow",
  "sunrise",
  "sunset",
  "meteor",
  "atom2",
  "mushroom",
  "clover",
  "yinYang",
  "pennant",
  "compass",
  "moon",
  "sun",
  "alien",
  "ghost",
  "ghost2",
  "ghost3",
  "ufo",
  "user",
  "campfire",
  "mountain",
  "library",
  "libraryPlus",
  "palette",
  "paint",
  "toolsKitchen2",
  "key",
  "circleKey",
  "lock",
  "archive",
  "asset",
  "container",
  "basket",
  "giftCard",
  "ticket",
  "briefcase2",
  "badge",
  "badges",
  "award",
  "rosette",
  "laurel",
  "trophy",
  "diamond",
  "diamonds",
  "coin",
  "fileStar",
  "tagsField",
  "refresh",
]);
export const defaultSharedViewIconId = "borderAll";

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
    filters: normalizeViewFilters(source.filters),
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
    const filters = normalizeViewFilters(source.filters);
    if (shouldKeepDraftFilters(source.filters, filters)) draft.filters = filters;
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
    structureDrafts: {},
  };
}

export function normalizeSharedViewDraftState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptySharedViewDraftState();
  return {
    lastActiveViews: normalizeStringRecord(value.lastActiveViews),
    viewDrafts: normalizeViewDrafts(value.viewDrafts),
    viewOrderDrafts: normalizeViewOrderDrafts(value.viewOrderDrafts),
    structureDrafts: normalizeStructureDrafts(value.structureDrafts),
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
      collections[normalizedKey] = normalizeSharedCollection(collectionConfig);
    }
  }
  return {
    version: 1,
    collections,
  };
}

function normalizeSharedCollection(collectionConfig) {
  const rawItems = Array.isArray(collectionConfig.items)
    ? collectionConfig.items
    : Array.isArray(collectionConfig.views)
      ? collectionConfig.views.map((view) => ({ kind: "view", view }))
      : [];
  return {
    defaultViewId: normalizeNullableString(collectionConfig.defaultViewId),
    items: normalizeSharedViewItems(rawItems),
  };
}

function normalizeSharedViewItems(value) {
  if (!Array.isArray(value)) return [];
  const items = [];
  const usedGroupIds = new Set();
  const usedViewIds = new Set();
  for (const item of value) {
    const normalized = normalizeSharedViewItem(item, usedGroupIds, usedViewIds);
    if (normalized) items.push(normalized);
  }
  return items;
}

function normalizeSharedViewItem(value, usedGroupIds, usedViewIds) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.kind === "group") {
    const id = normalizeString(value.id);
    const name = normalizeString(value.name);
    const views = Array.isArray(value.views)
      ? value.views
        .map((view) => normalizeSharedViewLeaf(view, usedViewIds))
        .filter(Boolean)
      : [];
    if (!id || usedGroupIds.has(id) || !name || views.length === 0) return null;
    usedGroupIds.add(id);
    return { kind: "group", id, name, views };
  }
  return normalizeSharedViewLeaf(value, usedViewIds);
}

export function normalizeSharedViewIcon(value) {
  const icon = normalizeString(value);
  return sharedViewIconIds.has(icon) ? icon : defaultSharedViewIconId;
}

export function normalizeSharedViewLeaf(value, usedViewIds = new Set()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rawView = value.kind === "view"
    ? ((value.view && typeof value.view === "object" && !Array.isArray(value.view)) ? value.view : value)
    : value;
  const view = normalizeCollectionView(rawView);
  if (!keepNormalizedView(view, usedViewIds)) return null;
  return {
    kind: "view",
    icon: normalizeSharedViewIcon(value.icon),
    view,
  };
}

function keepNormalizedView(view, usedViewIds) {
  if (!view?.id || !view?.name || usedViewIds.has(view.id)) return false;
  usedViewIds.add(view.id);
  return true;
}

function normalizeViewFilters(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (Array.isArray(source.rules)) {
    return {
      topLevelRules: normalizeLegacyFilterRules(source.rules),
      advancedRoot: null,
    };
  }
  return {
    topLevelRules: normalizeRuleNodes(source.topLevelRules),
    advancedRoot: normalizeGroupNode(source.advancedRoot),
  };
}

function normalizeLegacyFilterRules(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = normalizeString(item.id);
    const field = normalizeString(item.field);
    const operator = normalizeString(item.operator);
    if (!id || !field || !filterOperators.has(operator)) continue;
    const join = normalizeString(item.join);
    const rule = { kind: "rule", id, field, operator };
    if (join === "and" || join === "or") rule.join = join;
    if ("value" in item) rule.value = item.value;
    result.push(rule);
  }
  return result;
}

function normalizeRuleNodes(value) {
  return normalizeLegacyFilterRules(value);
}

function normalizeGroupNode(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = normalizeString(value.id);
  const op = normalizeString(value.op);
  const join = normalizeString(value.join);
  if (!id || (op !== "and" && op !== "or")) return null;
  return {
    kind: "group",
    id,
    op,
    ...(join === "and" || join === "or" ? { join } : {}),
    children: normalizeFilterNodes(value.children),
  };
}

function normalizeFilterNodes(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (item.kind === "group") {
      const group = normalizeGroupNode(item);
      if (group) result.push(group);
      continue;
    }
    const [rule] = normalizeLegacyFilterRules([item]);
    if (rule) result.push(rule);
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

function normalizeStructureDrafts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [collectionKey, rawDraft] of Object.entries(value)) {
    const normalizedCollectionKey = normalizeString(collectionKey);
    if (!normalizedCollectionKey || !rawDraft || typeof rawDraft !== "object" || Array.isArray(rawDraft)) continue;
    const items = normalizeStructureDraftItems(rawDraft.items);
    if (!items.length) continue;
    result[normalizedCollectionKey] = { items };
  }
  return result;
}

function normalizeStructureDraftItems(value) {
  if (!Array.isArray(value)) return [];
  const items = [];
  const usedViewIds = new Set();
  const usedGroupIds = new Set();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (item.kind === "view") {
      const viewId = normalizeString(item.viewId);
      if (!viewId || usedViewIds.has(viewId)) continue;
      usedViewIds.add(viewId);
      items.push({ kind: "view", viewId });
      continue;
    }
    if (item.kind === "group") {
      const groupId = normalizeString(item.groupId);
      const viewIds = normalizeStringArray(item.viewIds).filter((viewId) => {
        if (usedViewIds.has(viewId)) return false;
        usedViewIds.add(viewId);
        return true;
      });
      if (!groupId || usedGroupIds.has(groupId) || viewIds.length === 0) continue;
      usedGroupIds.add(groupId);
      const normalized = { kind: "group", groupId, viewIds };
      const name = normalizeString(item.name);
      if (name) normalized.name = name;
      items.push(normalized);
    }
  }
  return items;
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

function shouldKeepDraftFilters(rawValue, normalizedValue) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return false;
  if (Array.isArray(rawValue.rules)) {
    return rawValue.rules.length === 0 || normalizedValue.topLevelRules.length > 0;
  }
  const rawTopLevelRules = Array.isArray(rawValue.topLevelRules) ? rawValue.topLevelRules : [];
  const explicitEmptyNewFilters = rawTopLevelRules.length === 0
    && Object.hasOwn(rawValue, "topLevelRules")
    && Object.hasOwn(rawValue, "advancedRoot")
    && rawValue.advancedRoot == null;
  return rawTopLevelRules.length > 0
    || explicitEmptyNewFilters
    || Boolean(rawValue.advancedRoot)
    || normalizedValue.topLevelRules.length > 0
    || Boolean(normalizedValue.advancedRoot);
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
