// Restrict field metadata to colors, never arbitrary CSS expressions.
const hexColor = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function normalizeCheckboxPresentation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const checkedColor = typeof value.checkedColor === "string" && hexColor.test(value.checkedColor) ? value.checkedColor : undefined;
  const checkedOpacity = typeof value.checkedOpacity === "number" && Number.isFinite(value.checkedOpacity) && value.checkedOpacity >= 0 && value.checkedOpacity <= 1 ? value.checkedOpacity : undefined;
  if (checkedColor === undefined && checkedOpacity === undefined) return undefined;
  return { ...(checkedColor !== undefined ? { checkedColor } : {}), ...(checkedOpacity !== undefined ? { checkedOpacity } : {}) };
}

export function isValidCheckboxPresentation(value) {
  const normalized = normalizeCheckboxPresentation(value);
  return normalized !== undefined && Object.keys(value).every((key) => Object.hasOwn(normalized, key));
}

export function checkboxCheckedStyle(checked, presentation) {
  if (!checked) return undefined;
  const checkbox = normalizeCheckboxPresentation(presentation?.checkbox);
  if (!checkbox) return undefined;
  return {
    ...(checkbox.checkedColor !== undefined ? { accentColor: checkbox.checkedColor } : {}),
    ...(checkbox.checkedOpacity !== undefined ? { opacity: checkbox.checkedOpacity } : {}),
  };
}
