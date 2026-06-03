export function normalizeFileOrder(files, order) {
  const filePaths = files.map((file) => file.path);
  const filePathSet = new Set(filePaths);
  const seen = new Set();
  const normalized = [];
  for (const path of Array.isArray(order) ? order : []) {
    if (!filePathSet.has(path) || seen.has(path)) continue;
    seen.add(path);
    normalized.push(path);
  }
  for (const path of filePaths) {
    if (seen.has(path)) continue;
    seen.add(path);
    normalized.push(path);
  }
  return normalized;
}

export function moveFileToIndex(order, sourcePath, targetIndex) {
  const currentIndex = order.indexOf(sourcePath);
  if (currentIndex < 0) return [...order];
  const next = order.filter((path) => path !== sourcePath);
  const insertIndex = Math.min(Math.max(Math.round(targetIndex), 0), next.length);
  next.splice(insertIndex, 0, sourcePath);
  return next;
}
