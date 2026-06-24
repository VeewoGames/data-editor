import { normalizeStreamlineTags } from "./streamline-tag-normalization.mjs";

function normalizeTags(tags) {
  return normalizeStreamlineTags(tags);
}

export function normalizeOfficialMetadataRecord(record) {
  const hash = typeof record?.hash === "string" ? record.hash.trim() : "";
  const slug = typeof record?.slug === "string" ? record.slug.trim() : "";
  return {
    hash: hash || null,
    slug: slug || null,
    tags: normalizeTags(record?.tags),
  };
}

export function indexOfficialMetadataRecords(records) {
  const byHash = new Map();
  const bySlug = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const normalized = normalizeOfficialMetadataRecord(record);
    if (normalized.hash) {
      byHash.set(normalized.hash, normalized);
    }
    if (normalized.slug) {
      bySlug.set(normalized.slug, normalized);
    }
  }
  return { byHash, bySlug };
}

export function resolveOfficialMetadataForManifestItem(index, item) {
  const hash = typeof item?.hash === "string" ? item.hash.trim() : "";
  if (hash && index?.byHash instanceof Map && index.byHash.has(hash)) {
    const matched = index.byHash.get(hash);
    return {
      hash: matched.hash,
      slug: matched.slug,
      tags: matched.tags,
      matchedBy: "hash",
    };
  }

  const slug = typeof item?.slug === "string" ? item.slug.trim() : "";
  if (slug && index?.bySlug instanceof Map && index.bySlug.has(slug)) {
    const matched = index.bySlug.get(slug);
    return {
      hash: matched.hash,
      slug: matched.slug,
      tags: matched.tags,
      matchedBy: "slug",
    };
  }

  return null;
}
