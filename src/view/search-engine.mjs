import { applyViewFilters } from "./filtering.mjs";

const emptyFilters = { op: "and", rules: [] };

export function runSearch({ rows = [], query = "", candidateRowIds = null }) {
  const sourceRows = orderRowsBySourceOrder(rows);
  const candidateRows = resolveCandidateRows(sourceRows, candidateRowIds);
  const searchRows = materializeRows(
    applyViewFilters(candidateRows.map(createRuntimeRow), query, emptyFilters),
    candidateRows,
  );

  return {
    sourceRows,
    candidateRows,
    searchRows,
    sourceOrderRowIds: sourceRows.map((entry) => entry.rowId),
    candidateRowIds: candidateRowIds == null ? null : candidateRows.map((entry) => entry.rowId),
    searchRowIds: searchRows.map((entry) => entry.rowId),
  };
}

function orderRowsBySourceOrder(rows = []) {
  return [...rows].sort((left, right) => compareSourceOrder(left?.sourceOrder, right?.sourceOrder));
}

function resolveCandidateRows(sourceRows, candidateRowIds) {
  if (candidateRowIds == null) return sourceRows;
  if (!Array.isArray(candidateRowIds) || candidateRowIds.length === 0) return [];
  const allowed = new Set(candidateRowIds);
  return sourceRows.filter((entry) => allowed.has(entry.rowId));
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
    .map((row) => sourceRowsById.get(readRuntimeRowId(row)))
    .filter(Boolean);
}

function readRuntimeRowId(row) {
  return typeof row?.__viewRowId === "string" ? row.__viewRowId : null;
}

function compareSourceOrder(left, right) {
  if (left === right) return 0;
  if (typeof left !== "number") return 1;
  if (typeof right !== "number") return -1;
  return left - right;
}
