/**
 * @param {import("../model/document-store").CollectionStore | null} collectionStore
 * @param {string[]} visibleRowIds
 * @param {import("../model/document-store").TableRowView[] | null} [previousVisibleRowViews]
 * @returns {import("../model/document-store").TableRowView[]}
 */
export function buildVisibleRowViews(collectionStore, visibleRowIds, previousVisibleRowViews = null) {
  if (!collectionStore) return [];
  const previousByRowId = new Map((previousVisibleRowViews ?? []).map((rowView) => [rowView.rowId, rowView]));
  return visibleRowIds.map((rowId, fallbackIndex) => {
    const handle = collectionStore.handleById.get(rowId);
    const row = collectionStore.rowById.get(rowId);
    if (handle && row) {
      const previous = previousByRowId.get(rowId);
      if (
        previous &&
        previous.rowId === rowId &&
        previous.row === row &&
        previous.sourceIndex === handle.sourceIndex &&
        previous.sourceKey === handle.sourceKey
      ) {
        return previous;
      }
      return {
        rowId,
        row,
        sourceIndex: handle.sourceIndex,
        sourceKey: handle.sourceKey,
      };
    }
    const sourceIndex = collectionStore.sourceIndexByRowId.get(rowId) ?? fallbackIndex;
    const resolvedRow = row ?? (collectionStore.rowViews[sourceIndex]?.row ?? {});
    const resolvedSourceKey = handle?.sourceKey ?? null;
    const previous = previousByRowId.get(rowId);
    if (
      previous &&
      previous.rowId === rowId &&
      previous.row === resolvedRow &&
      previous.sourceIndex === sourceIndex &&
      previous.sourceKey === resolvedSourceKey
    ) {
      return previous;
    }
    return {
      rowId,
      row: resolvedRow,
      sourceIndex,
      sourceKey: resolvedSourceKey,
    };
  });
}

/**
 * @param {{
 *   collectionStore: import("../model/document-store").CollectionStore | null;
 *   visibleRowIds: string[];
 *   selectedRowId: string | null;
 *   selectedRowIndex: number | null;
 *   previousVisibleRowViews?: import("../model/document-store").TableRowView[] | null;
 * }} input
 * @returns {{
 *   visibleRowViews: import("../model/document-store").TableRowView[];
 *   selectedRowView: import("../model/document-store").TableRowView | null;
 *   selectedRow: Record<string, unknown> | null;
 *   resolvedRowId: string | null;
 *   resolvedSourceRowIndex: number | null;
 *   selectedVisibleRowPosition: number | null;
 *   previousRowTarget: { sourceRowIndex: number; rowId: string | null } | null;
 *   nextRowTarget: { sourceRowIndex: number; rowId: string | null } | null;
 * }}}
 */
export function buildDetailSelectionState({
  collectionStore,
  visibleRowIds,
  selectedRowId,
  selectedRowIndex,
  previousVisibleRowViews = null,
}) {
  const visibleRowViews = buildVisibleRowViews(collectionStore, visibleRowIds, previousVisibleRowViews);
  const selectedRowView = resolveSelectedRowView(collectionStore, selectedRowId, selectedRowIndex);
  const resolvedRowId = selectedRowView?.rowId ?? selectedRowId ?? null;
  const resolvedSourceRowIndex = selectedRowView?.sourceIndex
    ?? (resolvedRowId == null ? null : (collectionStore?.sourceIndexByRowId.get(resolvedRowId) ?? null))
    ?? selectedRowIndex;
  const selectedVisibleRowPosition = resolvedRowId == null ? null : resolveVisibleRowPosition(visibleRowIds, resolvedRowId);
  const previousRowTarget = (
    selectedVisibleRowPosition == null
    || selectedVisibleRowPosition <= 0
  )
    ? null
    : toRowTarget(visibleRowViews[selectedVisibleRowPosition - 1] ?? null);
  const nextRowTarget = (
    selectedVisibleRowPosition == null
    || selectedVisibleRowPosition >= visibleRowViews.length - 1
  )
    ? null
    : toRowTarget(visibleRowViews[selectedVisibleRowPosition + 1] ?? null);
  return {
    visibleRowViews,
    selectedRowView,
    selectedRow: selectedRowView?.row ?? null,
    resolvedRowId,
    resolvedSourceRowIndex,
    selectedVisibleRowPosition,
    previousRowTarget,
    nextRowTarget,
  };
}

/**
 * @param {{
 *   collectionStore: import("../model/document-store").CollectionStore | null;
 *   selectedRowId: string | null;
 *   selectedRowIndex: number | null;
 * }} input
 * @returns {{ nextRowId: string | null; nextRowIndex: number | null } | null}
 */
export function resolveDetailSelectionSync({
  collectionStore,
  selectedRowId,
  selectedRowIndex,
}) {
  if (!collectionStore) return null;
  if (selectedRowId) {
    const sourceIndex = collectionStore.sourceIndexByRowId.get(selectedRowId);
    if (sourceIndex != null) {
      return {
        nextRowId: selectedRowId,
        nextRowIndex: sourceIndex,
      };
    }
    const fallbackSourceIndex = selectedRowIndex != null && collectionStore.rowViews[selectedRowIndex]
      ? selectedRowIndex
      : (collectionStore.rowViews[0]?.sourceIndex ?? null);
    const fallbackRowId = fallbackSourceIndex == null ? null : (collectionStore.rowViews[fallbackSourceIndex]?.rowId ?? null);
    return {
      nextRowId: fallbackRowId,
      nextRowIndex: fallbackSourceIndex,
    };
  }
  if (selectedRowIndex == null) return null;
  return {
    nextRowId: collectionStore.rowViews[selectedRowIndex]?.rowId ?? null,
    nextRowIndex: selectedRowIndex,
  };
}

function resolveSelectedRowView(collectionStore, selectedRowId, selectedRowIndex) {
  if (!collectionStore) return null;
  if (selectedRowId) {
    const sourceIndex = collectionStore.sourceIndexByRowId.get(selectedRowId);
    if (sourceIndex != null) return collectionStore.rowViews[sourceIndex] ?? null;
  }
  return selectedRowIndex == null ? null : (collectionStore.rowViews[selectedRowIndex] ?? null);
}

function resolveVisibleRowPosition(visibleRowIds, selectedRowId) {
  const index = visibleRowIds.indexOf(selectedRowId);
  return index >= 0 ? index : null;
}

function toRowTarget(rowView) {
  return rowView ? { sourceRowIndex: rowView.sourceIndex, rowId: rowView.rowId } : null;
}
