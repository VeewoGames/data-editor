import { parseStreamlineSourceId } from "./manifest-store.mjs";
import { normalizeStreamlineTags } from "./streamline-tag-normalization.mjs";

export function normalizeMetadataTags(tags) {
  return normalizeStreamlineTags(tags, { lowercase: true });
}

export function extractDetailStatePayload(html) {
  const source = String(html ?? "");
  if (source.trim().startsWith("{")) {
    return JSON.parse(source);
  }
  const scriptMatch = source.match(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch?.[1]) {
    throw new Error("Streamline detail metadata payload not found");
  }
  return JSON.parse(scriptMatch[1]);
}

export function findIconDetailsInStatePayload(payload, { iconUrl, slug }) {
  const expectedSlug = String(slug ?? "").trim();
  const expectedSourceId = parseStreamlineSourceId(iconUrl);
  const queries = payload?.props?.pageProps?.initialState?.streamlineApi?.queries ?? {};

  for (const entry of Object.values(queries)) {
    if (entry?.endpointName !== "getIconDetailsBySlugAndSubcategoryId") {
      continue;
    }

    const entrySlug = String(entry?.data?.slug ?? entry?.originalArgs?.iconSlug ?? "").trim();
    const entrySourceId = String(
      entry?.originalArgs?.subcategoryId ??
      entry?.data?.subcategoryId ??
      "",
    ).trim();

    if (expectedSlug && entrySlug !== expectedSlug) {
      continue;
    }
    if (expectedSourceId && entrySourceId && entrySourceId !== expectedSourceId) {
      continue;
    }

    return {
      name: String(entry?.data?.name ?? entrySlug).trim(),
      slug: entrySlug,
      sourceId: entrySourceId || expectedSourceId || null,
      tags: normalizeMetadataTags(entry?.data?.tags),
    };
  }

  throw new Error(`Streamline detail metadata payload not found for ${expectedSlug || iconUrl}`);
}

export function parseStreamlineDetailMetadataRecord(html, { iconUrl, slug }) {
  const normalizedIconUrl = String(iconUrl ?? "").trim();
  if (!normalizedIconUrl) {
    throw new Error("iconUrl is required");
  }

  const payload = extractDetailStatePayload(html);
  const details = findIconDetailsInStatePayload(payload, { iconUrl: normalizedIconUrl, slug });

  return {
    iconUrl: normalizedIconUrl,
    name: details.name,
    slug: details.slug,
    sourceId: details.sourceId,
    tags: details.tags,
  };
}
