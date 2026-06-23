export function normalizeIconSlugToFilename(slug) {
  const normalized = String(slug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${normalized || "icon"}.svg`;
}
