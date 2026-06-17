import { applyViewFilters } from "./filtering.mjs";
import { applyViewSorts } from "./sorting.mjs";
import { runSearch } from "./search-engine.mjs";

const emptyFilters = { op: "and", rules: [] };
const emptySorts = [];

export function runView({
  rows = [],
  query = "",
  candidateRowIds = null,
  filters = emptyFilters,
  sorts = emptySorts,
  fieldTypes = {},
  optionOrdersByField = {},
}) {
  const searchResult = runSearch({ rows, query, candidateRowIds });
  const filteredRows = materializeRows(
    applyViewFilters(searchResult.searchRows.map(createRuntimeRow), "", filters, fieldTypes),
    searchResult.searchRows,
  );
  const visibleRows = materializeRows(
    applyViewSorts(filteredRows.map(createRuntimeRow), sorts, fieldTypes, optionOrdersByField),
    filteredRows,
  );

  return {
    sourceRows: searchResult.sourceRows,
    candidateRows: searchResult.candidateRows,
    searchRows: searchResult.searchRows,
    filteredRows,
    visibleRows,
    sourceOrderRowIds: searchResult.sourceOrderRowIds,
    candidateRowIds: searchResult.candidateRowIds,
    searchRowIds: searchResult.searchRowIds,
    filteredRowIds: filteredRows.map((entry) => entry.rowId),
    visibleRowIds: visibleRows.map((entry) => entry.rowId),
  };
}

function createRuntimeRow(entry) {
  const runtimeRow = { ...(entry?.row ?? {}) };
  Object.defineProperty(runtimeRow, "__viewRowId", {
    value: entry?.rowId ?? null,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(runtimeRow, "__rowIndex", {
    value: typeof entry?.sourceOrder === "number" ? entry.sourceOrder : -1,
    enumerable: false,
    configurable: true,
  });
  return runtimeRow;
}

function materializeRows(runtimeRows, sourceRows) {
  const sourceRowsById = new Map(sourceRows.map((entry) => [entry.rowId, entry]));
  return runtimeRows
    .map((row) => {
      const rowId = typeof row?.__viewRowId === "string" ? row.__viewRowId : null;
      return rowId ? (sourceRowsById.get(rowId) ?? null) : null;
    })
    .filter(Boolean);
}
