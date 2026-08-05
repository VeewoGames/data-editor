export const derivedFieldNames = Object.freeze([]);

export const derivedFieldTypes = Object.freeze({});

export function isDerivedField(_fieldName) {
  return false;
}

export function discoverProjectedFields(fields, _context = {}) {
  return [...new Set(Array.isArray(fields) ? fields : [])];
}

export function projectDerivedFields(row, _context = {}) {
  return row;
}

export function projectViewEngineRows(rows, _context = {}) {
  return rows;
}
