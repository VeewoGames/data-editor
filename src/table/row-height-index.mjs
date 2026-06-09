/**
 * @param {string} rowId
 * @param {Record<string, number>} measuredHeights
 * @param {number} estimatedHeight
 */
export function resolveRowHeight(rowId, measuredHeights, estimatedHeight) {
  const measured = measuredHeights[rowId];
  return Number.isFinite(measured) && measured > 0 ? measured : estimatedHeight;
}

/**
 * @param {Record<string, number>} previous
 * @param {Record<string, number>} nextMeasurements
 * @returns {Record<string, number>}
 */
export function mergeMeasuredRowHeights(previous, nextMeasurements) {
  let changed = false;
  const next = { ...previous };
  for (const [rowId, rawHeight] of Object.entries(nextMeasurements)) {
    if (!Number.isFinite(rawHeight) || rawHeight <= 0) continue;
    const height = round(rawHeight);
    if (next[rowId] === height) continue;
    next[rowId] = height;
    changed = true;
  }
  return changed ? next : previous;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
