export function reorderSortRulesById(sorts, orderedIds) {
  const sortById = new Map(sorts.map((sort) => [sort.id, sort]));
  const seen = new Set();
  const reordered = [];

  for (const id of orderedIds) {
    const sort = sortById.get(id);
    if (!sort || seen.has(id)) continue;
    reordered.push(sort);
    seen.add(id);
  }

  for (const sort of sorts) {
    if (seen.has(sort.id)) continue;
    reordered.push(sort);
  }

  return reordered;
}
