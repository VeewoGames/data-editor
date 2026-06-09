const rowIdSymbol = Symbol.for("data-editor.row-id");

let nextRowIdSeed = 1;

export function createRowId() {
  const rowId = `row_${nextRowIdSeed.toString(36)}`;
  nextRowIdSeed += 1;
  return rowId;
}

export function isRowId(value) {
  return typeof value === "string" && value.length > 0;
}

export function serializeRowId(rowId) {
  if (!isRowId(rowId)) throw new Error("RowId must be a non-empty string");
  return rowId;
}

export function parseRowId(value) {
  return isRowId(value) ? value : null;
}

export function ensureRowId(target) {
  if (!isRowIdCarrier(target)) return createRowId();
  if (isRowId(target[rowIdSymbol])) return target[rowIdSymbol];
  return attachRowId(target, createRowId());
}

export function attachRowId(target, rowId) {
  if (!isRowIdCarrier(target)) return rowId;
  if (isRowId(target[rowIdSymbol])) return target[rowIdSymbol];
  if (!isRowId(rowId)) throw new Error("RowId must be a non-empty string");
  Object.defineProperty(target, rowIdSymbol, {
    value: rowId,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return rowId;
}

export function readRowId(target) {
  return isRowIdCarrier(target) && isRowId(target[rowIdSymbol]) ? target[rowIdSymbol] : null;
}

function isRowIdCarrier(value) {
  return Boolean(value) && (typeof value === "object" || typeof value === "function");
}
