/**
 * @typedef {import("../model/document-store").TableRowView} TableRowView
 */

/**
 * @param {{
 *   rowViews: TableRowView[];
 *   windowStart: number;
 *   previousContract?: {
 *     rows: Array<Record<string, unknown> & { __rowIndex: number; __rowId: string }>;
 *   } | null;
 * }} input
 */
export function buildVisibleTableRenderContract({ rowViews, windowStart, previousContract = null }) {
  const previousRowsById = new Map((previousContract?.rows ?? []).map((row) => [String(row.__rowId ?? row.__rowIndex), row]));
  const rows = rowViews.map((rowView, index) => {
    const rowIndex = rowView.sourceIndex ?? windowStart + index;
    const previousRow = previousRowsById.get(rowView.rowId);
    if (
      previousRow &&
      previousRow.__rowId === rowView.rowId &&
      previousRow.__rowIndex === rowIndex &&
      sameShallowRowValue(previousRow, rowView.row)
    ) {
      return previousRow;
    }
    return {
      ...rowView.row,
      __rowIndex: rowIndex,
      __rowId: rowView.rowId,
    };
  });

  return {
    rows,
    rowIds: rows.map((row) => String(row.__rowId ?? row.__rowIndex)),
    windowStart,
    rowCount: rows.length,
  };
}

function sameShallowRowValue(previousRow, nextRow) {
  const nextKeys = Object.keys(nextRow ?? {});
  const previousKeys = Object.keys(previousRow ?? {}).filter((key) => key !== "__rowIndex" && key !== "__rowId");
  if (previousKeys.length !== nextKeys.length) return false;
  return nextKeys.every((key) => previousRow[key] === nextRow[key]);
}
