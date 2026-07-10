export function describeFileBasename(filePath) {
  const normalized = String(filePath ?? "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

export function matchesFileSearchQuery(filePath, query) {
  const normalized = String(query ?? "").trim().toLowerCase();
  if (!normalized) return true;
  const fullPath = String(filePath ?? "").toLowerCase();
  const basename = describeFileBasename(filePath).toLowerCase();
  return fullPath.includes(normalized) || basename.includes(normalized);
}
