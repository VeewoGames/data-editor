export function resolveCanReorderRows({
  model,
  collectionPath,
  query = "",
  filters = null,
  sorts = [],
  commandSaving = false,
  closing = false,
  rebuilding = false,
  restarting = false,
}) {
  if (!isArrayCollection(model, collectionPath)) return false;
  if (String(query ?? "").trim()) return false;
  if (hasActiveFilters(filters)) return false;
  if (Array.isArray(sorts) && sorts.length > 0) return false;
  return !commandSaving && !closing && !rebuilding && !restarting;
}

function isArrayCollection(model, collectionPath) {
  if (!model || typeof collectionPath !== "string") return false;
  if (collectionPath === "$") return Array.isArray(model.root);
  return isPlainObject(model.root) && Array.isArray(model.root[collectionPath]);
}

function hasActiveFilters(filters) {
  return Boolean(
    (Array.isArray(filters?.topLevelRules) && filters.topLevelRules.length > 0)
    || filters?.advancedRoot,
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
