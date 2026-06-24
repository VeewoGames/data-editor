function sanitizeTagText(value, { lowercase = false } = {}) {
  let text = String(value ?? "").trim();
  text = text.replace(/^```[a-z0-9_-]*\s*/i, "");
  text = text.replace(/\s*```$/i, "");
  text = text.replace(/\s+/g, " ").trim();
  if (lowercase) {
    text = text.toLowerCase();
  }
  return text;
}

export function normalizeStreamlineTags(tags, { lowercase = false } = {}) {
  return Array.from(
    new Set(
      (Array.isArray(tags) ? tags : [])
        .map((value) => sanitizeTagText(value, { lowercase }))
        .filter(Boolean),
    ),
  );
}
