export const rowDragThreshold = 4;
export const rowAutoScrollEdgeSize = 48;

export function isPreciseRowDragPointer(pointerType) {
  return pointerType === "mouse" || pointerType === "pen";
}

export function hasExceededRowDragThreshold(startX, startY, clientX, clientY, threshold = rowDragThreshold) {
  return Math.hypot(clientX - startX, clientY - startY) > threshold;
}

export function resolveRowDropTarget({
  sourceRowId,
  pointerX,
  pointerY,
  containerRect,
  rowRects,
  rowIds,
}) {
  if (
    !containerRect
    || pointerX < containerRect.left
    || pointerX > containerRect.right
    || pointerY < containerRect.top
    || pointerY > containerRect.bottom
  ) return null;
  const candidates = rowRects
    .filter((item) => item && item.rowId && Number.isFinite(item.top) && Number.isFinite(item.bottom))
    .sort((left, right) => left.top - right.top);
  if (candidates.length === 0) return null;

  let target = candidates.find((item) => pointerY >= item.top && pointerY <= item.bottom) ?? null;
  if (!target) {
    target = pointerY < candidates[0].top
      ? candidates[0]
      : candidates[candidates.length - 1];
  }
  if (target.rowId === sourceRowId) return null;

  const placement = pointerY < (target.top + target.bottom) / 2 ? "before" : "after";
  return isEffectiveRowDrop(rowIds, sourceRowId, target.rowId, placement)
    ? { rowId: target.rowId, placement }
    : null;
}

export function resolveRowAutoScrollDelta({
  pointerY,
  containerTop,
  containerBottom,
  edgeSize = rowAutoScrollEdgeSize,
  maxSpeed = 18,
}) {
  if (pointerY < containerTop + edgeSize) {
    const ratio = clamp((containerTop + edgeSize - pointerY) / edgeSize, 0, 1);
    return -Math.max(1, Math.round(maxSpeed * ratio * ratio));
  }
  if (pointerY > containerBottom - edgeSize) {
    const ratio = clamp((pointerY - (containerBottom - edgeSize)) / edgeSize, 0, 1);
    return Math.max(1, Math.round(maxSpeed * ratio * ratio));
  }
  return 0;
}

export function reorderRowIds(rowIds, sourceRowId, targetRowId, placement) {
  const sourceIndex = rowIds.indexOf(sourceRowId);
  const targetIndex = rowIds.indexOf(targetRowId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [...rowIds];
  const next = [...rowIds];
  const [source] = next.splice(sourceIndex, 1);
  let insertionIndex = targetIndex;
  if (sourceIndex < targetIndex) insertionIndex -= 1;
  if (placement === "after") insertionIndex += 1;
  next.splice(insertionIndex, 0, source);
  return next;
}

function isEffectiveRowDrop(rowIds, sourceRowId, targetRowId, placement) {
  const next = reorderRowIds(rowIds, sourceRowId, targetRowId, placement);
  return next.some((rowId, index) => rowId !== rowIds[index]);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
