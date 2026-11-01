/** A committed view order with point-updated heights and logarithmic offset lookup. */
export function createRowHeightIndex(rowIds, getRowHeight) {
  const ids = [...rowIds], positions = new Map(ids.map((id, i) => [id, i]));
  const heights = ids.map((id, i) => Math.max(1, getRowHeight(id, i)));
  const tree = new Float64Array(ids.length + 1);
  for (let i = 1; i < tree.length; i++) { tree[i] += heights[i - 1]; const parent = i + (i & -i); if (parent < tree.length) tree[parent] += tree[i]; }
  let visits = 0;
  const prefix = end => { let total = 0; for (let i = Math.min(ids.length, Math.max(0, end)); i > 0; i -= i & -i) { total += tree[i]; visits++; } return total; };
  const indexAt = offset => {
    let index = 0, sum = 0, bit = 1; while (bit * 2 <= ids.length) bit *= 2;
    for (; bit; bit = Math.floor(bit / 2)) { const next = index + bit; visits++; if (next <= ids.length && sum + tree[next] <= offset) { index = next; sum += tree[next]; } }
    return index;
  };
  return {
    rowIds: ids, prefix, indexAt, position: id => positions.get(id), height: i => heights[i],
    update(rowId, rawHeight) {
      const i = positions.get(rowId); if (i == null || !Number.isFinite(rawHeight) || rawHeight <= 0) return false;
      const value = Math.max(1, Math.round(rawHeight * 100) / 100), delta = value - heights[i]; if (!delta) return false;
      heights[i] = value; for (let n = i + 1; n < tree.length; n += n & -n) { tree[n] += delta; visits++; } return true;
    },
    // Counts tree work rather than depending on machine timing in complexity tests.
    takeVisitCount() { const value = visits; visits = 0; return value; },
  };
}

export function buildVariableRowWindow({ index, viewportHeight, scrollTop, overscan }) {
  const count = index.rowIds.length, totalHeight = index.prefix(count);
  const top = Math.max(0, Math.min(scrollTop, Math.max(0, totalHeight - viewportHeight)));
  const bottom = top + Math.max(1, viewportHeight);
  const visibleStart = index.indexAt(top);
  let visibleEnd = index.indexAt(bottom);
  if (visibleEnd < count && index.prefix(visibleEnd) < bottom) visibleEnd++;
  const windowStart = Math.max(0, visibleStart - overscan), windowEnd = Math.min(count, visibleEnd + overscan);
  const topSpacerHeight = index.prefix(windowStart), bottomSpacerHeight = Math.max(0, totalHeight - index.prefix(windowEnd));
  return { windowStart, windowEnd, topSpacerHeight, bottomSpacerHeight, totalHeight };
}

export function captureRowAnchor(index, scrollTop) {
  const position = Math.min(index.rowIds.length - 1, index.indexAt(Math.max(0, scrollTop)));
  return position < 0 ? null : { rowId: index.rowIds[position], position, offset: scrollTop - index.prefix(position) };
}

export function restoreRowAnchor(previous, next, anchor) {
  if (!anchor || !next.rowIds.length) return 0;
  let position = next.position(anchor.rowId);
  if (position == null) {
    for (let i = anchor.position + 1; i < previous.rowIds.length && position == null; i++) position = next.position(previous.rowIds[i]);
    for (let i = anchor.position - 1; i >= 0 && position == null; i--) position = next.position(previous.rowIds[i]);
  }
  return position == null ? 0 : next.prefix(position) + Math.max(0, Math.min(anchor.offset, next.height(position) - 1));
}
