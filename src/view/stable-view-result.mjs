/**
 * @param {import("./contracts").ViewResult | null} previous
 * @param {import("./contracts").ViewResult} next
 * @returns {import("./contracts").ViewResult}
 */
export function stabilizeViewResult(previous, next) {
  if (!previous) return next;
  return {
    ...next,
    sourceOrderRowIds: reuseStringArray(previous.sourceOrderRowIds, next.sourceOrderRowIds),
    candidateRowIds: reuseNullableStringArray(previous.candidateRowIds, next.candidateRowIds),
    searchRowIds: reuseStringArray(previous.searchRowIds, next.searchRowIds),
    filteredRowIds: reuseStringArray(previous.filteredRowIds, next.filteredRowIds),
    visibleRowIds: reuseStringArray(previous.visibleRowIds, next.visibleRowIds),
  };
}

function reuseNullableStringArray(previous, next) {
  if (previous == null || next == null) return next;
  return reuseStringArray(previous, next);
}

function reuseStringArray(previous, next) {
  if (previous === next) return previous;
  if (previous.length !== next.length) return next;
  return previous.every((value, index) => value === next[index]) ? previous : next;
}
