export const fieldTypes = ["Text", "Select", "Document"];

export function isCompatible(type, value) {
  if (type === "Text" || type === "JSON") return true;
  if (type === "Number") return value == null || typeof value === "number" || (typeof value === "string" && (value.trim() === "" || Number.isFinite(Number(value))));
  if (type === "Checkbox") return value == null || typeof value === "boolean";
  if (type === "Select") return value == null || ["string", "number"].includes(typeof value);
  if (type === "Document") return value == null || ["string", "number"].includes(typeof value);
  if (type === "Multi-select") return value == null || (Array.isArray(value) && value.every((item) => item == null || ["string", "number"].includes(typeof item)));
  if (type === "Relation") {
    if (value == null) return true;
    if (["string", "number"].includes(typeof value)) return true;
    return Array.isArray(value) && value.every((item) => item == null || ["string", "number"].includes(typeof item));
  }
  if (type === "Backlink") {
    if (value == null) return true;
    return Array.isArray(value);
  }
  if (type === "Date") return typeof value === "string" || typeof value === "number";
  if (type === "Nested") return Boolean(value) && typeof value === "object";
  return false;
}

export function defaultTypeFor(value) {
  if (typeof value === "number") return "Number";
  if (typeof value === "boolean") return "Checkbox";
  if (Array.isArray(value)) return isCompatible("Multi-select", value) ? "Multi-select" : "Nested";
  if (value && typeof value === "object") return "Nested";
  return "Text";
}
