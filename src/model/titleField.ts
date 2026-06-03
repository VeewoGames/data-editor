import type { DataRecord } from "./documentModel";

export function findTitleField(fields: string[], rows: DataRecord[]) {
  if (fields.includes("name")) return "name";
  const nameSuffix = fields.find((field) => field.endsWith("_name"));
  if (nameSuffix) return nameSuffix;
  return fields[0] ?? null;
}

export function getRecordTitle(row: DataRecord | null, fields: string[], rowIndex: number | null) {
  if (!row || rowIndex == null) return "";
  const titleField = findTitleField(fields.length ? fields : Object.keys(row), [row]);
  const value = titleField ? row[titleField] : null;
  return value != null && value !== "" ? String(value) : `Row ${rowIndex + 1}`;
}
