/**
 * @param {{
 *   rowIds: string[];
 *   viewportHeight: number;
 *   scrollTop: number;
 *   overscan: number;
 *   getRowHeight: (rowId: string, index: number) => number;
 * }} input
 */
export function buildVariableRowWindow({
  rowIds,
  viewportHeight,
  scrollTop,
  overscan,
  getRowHeight,
}) {
  if (!rowIds.length) {
    return {
      windowStart: 0,
      windowEnd: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      totalHeight: 0,
    };
  }

  const heights = rowIds.map((rowId, index) => Math.max(1, getRowHeight(rowId, index)));
  const totalHeight = heights.reduce((sum, height) => sum + height, 0);
  const clampedScrollTop = Math.max(0, Math.min(scrollTop, Math.max(0, totalHeight - viewportHeight)));
  const viewportBottom = clampedScrollTop + Math.max(1, viewportHeight);

  let visibleStart = 0;
  let offset = 0;
  while (visibleStart < heights.length && offset + heights[visibleStart] <= clampedScrollTop) {
    offset += heights[visibleStart];
    visibleStart += 1;
  }

  let visibleEnd = visibleStart;
  let viewportOffset = offset;
  while (visibleEnd < heights.length && viewportOffset < viewportBottom) {
    viewportOffset += heights[visibleEnd];
    visibleEnd += 1;
  }

  const windowStart = Math.max(0, visibleStart - overscan);
  const windowEnd = Math.min(heights.length, visibleEnd + overscan);
  const topSpacerHeight = heights.slice(0, windowStart).reduce((sum, height) => sum + height, 0);
  const windowHeight = heights.slice(windowStart, windowEnd).reduce((sum, height) => sum + height, 0);
  const bottomSpacerHeight = Math.max(0, totalHeight - topSpacerHeight - windowHeight);

  return {
    windowStart,
    windowEnd,
    topSpacerHeight,
    bottomSpacerHeight,
    totalHeight,
  };
}
