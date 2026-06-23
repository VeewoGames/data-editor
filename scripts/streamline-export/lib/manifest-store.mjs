import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { normalizeIconSlugToFilename } from "./normalize-name.mjs";

export function parseStreamlineSourceId(iconUrl) {
  const match = String(iconUrl ?? "").match(/--(\d+)(?:\b|$)/);
  return match?.[1] ?? null;
}

function buildManifestItemId(slug, sourceId, hasVariantCollision) {
  if (hasVariantCollision && sourceId) {
    return `${slug}--${sourceId}`;
  }
  return slug;
}

function buildManifestOutputPath(outputDir, slug, sourceId, hasVariantCollision) {
  const fileSlug = hasVariantCollision && sourceId ? `${slug}-${sourceId}` : slug;
  return join(outputDir, normalizeIconSlugToFilename(fileSlug)).replace(/\\/g, "/");
}

export function hydrateManifestItems(items, { outputDir }) {
  const sourceItems = Array.isArray(items) ? items : [];
  const uniqueUrlsBySlug = new Map();

  for (const item of sourceItems) {
    const slug = String(item?.slug ?? "").trim();
    if (!slug) continue;
    const url = String(item?.iconUrl ?? "").trim();
    const values = uniqueUrlsBySlug.get(slug) ?? new Set();
    if (url) {
      values.add(url);
    }
    uniqueUrlsBySlug.set(slug, values);
  }

  return sourceItems.map((item) => {
    const slug = String(item?.slug ?? "").trim();
    const sourceId = item?.sourceId ?? parseStreamlineSourceId(item?.iconUrl);
    const hasVariantCollision = (uniqueUrlsBySlug.get(slug)?.size ?? 0) > 1;
    const nextOutputDir = outputDir ?? dirname(String(item?.outputPath ?? ""));
    return {
      ...item,
      slug,
      sourceId,
      itemId: item?.itemId ?? buildManifestItemId(slug, sourceId, hasVariantCollision),
      outputPath: buildManifestOutputPath(nextOutputDir, slug, sourceId, hasVariantCollision),
    };
  });
}

export async function loadManifest(manifestPath) {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

export async function saveManifest(manifestPath, manifest) {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function summarizeManifest(manifest) {
  const counts = {
    total: 0,
    pending: 0,
    success: 0,
    failed: 0,
  };
  for (const item of Array.isArray(manifest?.items) ? manifest.items : []) {
    counts.total += 1;
    if (item?.status === "success") {
      counts.success += 1;
    } else if (item?.status === "failed") {
      counts.failed += 1;
    } else {
      counts.pending += 1;
    }
  }
  return counts;
}

export async function loadManifestSummary(manifestPath) {
  return summarizeManifest(await loadManifest(manifestPath));
}

export async function createManifest({ manifestPath, family, items, outputDir }) {
  const hydratedItems = hydrateManifestItems(items, { outputDir });
  const manifest = {
    family,
    generatedAt: new Date().toISOString(),
    items: hydratedItems.map((item) => ({
      itemId: item.itemId,
      slug: item.slug,
      sourceId: item.sourceId,
      name: item.name,
      iconUrl: item.iconUrl,
      status: "pending",
      attempts: 0,
      outputPath: item.outputPath,
      error: null,
      extractedAt: null,
    })),
  };
  await saveManifest(manifestPath, manifest);
}

function matchesManifestItem(item, { itemId, slug }) {
  if (itemId) {
    return item?.itemId === itemId;
  }
  return item?.slug === slug;
}

function updateItem(manifest, identity, updater) {
  let found = false;
  const items = manifest.items.map((item) => {
    if (!matchesManifestItem(item, identity)) return item;
    found = true;
    return updater(item);
  });
  if (!found) {
    throw new Error(`Manifest item not found: ${identity.itemId ?? identity.slug}`);
  }
  return { ...manifest, items };
}

export async function markManifestItemSuccess({ manifestPath, itemId, slug, extractedAt }) {
  const manifest = await loadManifest(manifestPath);
  await saveManifest(
    manifestPath,
    updateItem(manifest, { itemId, slug }, (item) => ({
      ...item,
      status: "success",
      error: null,
      extractedAt,
    })),
  );
}

export async function markManifestItemFailed({ manifestPath, itemId, slug, error }) {
  const manifest = await loadManifest(manifestPath);
  await saveManifest(
    manifestPath,
    updateItem(manifest, { itemId, slug }, (item) => ({
      ...item,
      status: "failed",
      attempts: (item.attempts ?? 0) + 1,
      error,
    })),
  );
}
