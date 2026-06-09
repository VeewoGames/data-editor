/**
 * @param {import("../model/document-store").CollectionStore | null} collectionStore
 * @param {import("./contracts").ViewEngineRow[] | null} previousRows
 * @returns {import("./contracts").ViewEngineRow[]}
 */
export function buildStableViewEngineRows(collectionStore, previousRows = null) {
  if (!collectionStore) return [];
  const previousByRowId = new Map((previousRows ?? []).map((row) => [row.rowId, row]));
  return collectionStore.rowViews.map((view) => {
    const previous = previousByRowId.get(view.rowId);
    if (
      previous &&
      previous.rowId === view.rowId &&
      previous.sourceOrder === view.sourceIndex &&
      previous.row === view.row
    ) {
      return previous;
    }
    return {
      rowId: view.rowId,
      sourceOrder: view.sourceIndex,
      row: view.row,
    };
  });
}
