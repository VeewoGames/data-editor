import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { normalizeIconSlugToFilename } from "./normalize-name.mjs";
import { normalizeStreamlineTags } from "./streamline-tag-normalization.mjs";

const DEFAULT_MANIFEST_IO_RETRY_COUNT = 5;
const DEFAULT_MANIFEST_IO_RETRY_DELAY_MS = 25;

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
      hash: typeof item?.hash === "string" && item.hash.trim() ? item.hash.trim() : null,
      sourceId,
      itemId: item?.itemId ?? buildManifestItemId(slug, sourceId, hasVariantCollision),
      outputPath: buildManifestOutputPath(nextOutputDir, slug, sourceId, hasVariantCollision),
    };
  });
}

function normalizeManifestItem(item) {
  const tags = normalizeStreamlineTags(item?.tags);

  return {
    ...item,
    tags,
    metadataStatus: item?.metadataStatus === "success" || item?.metadataStatus === "failed"
      ? item.metadataStatus
      : "pending",
    metadataError: item?.metadataError ?? null,
    metadataUpdatedAt: item?.metadataUpdatedAt ?? null,
  };
}

function sleep(delayMs) {
  if (!(delayMs > 0)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isRetriableManifestIoError(error) {
  const code = typeof error?.code === "string" ? error.code.toUpperCase() : "";
  return code === "UNKNOWN" || code === "EBUSY" || code === "EPERM";
}

async function withManifestIoRetry(operation, {
  retryCount = DEFAULT_MANIFEST_IO_RETRY_COUNT,
  retryDelayMs = DEFAULT_MANIFEST_IO_RETRY_DELAY_MS,
} = {}) {
  let lastError = null;
  const maxAttempts = Math.max(1, Number.isInteger(retryCount) ? retryCount : DEFAULT_MANIFEST_IO_RETRY_COUNT);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetriableManifestIoError(error) || attempt >= maxAttempts) {
        throw error;
      }
      await sleep(retryDelayMs);
    }
  }

  throw lastError;
}

export async function loadManifest(manifestPath, {
  readFileImpl = readFile,
  retryCount = DEFAULT_MANIFEST_IO_RETRY_COUNT,
  retryDelayMs = DEFAULT_MANIFEST_IO_RETRY_DELAY_MS,
} = {}) {
  const manifest = JSON.parse(await withManifestIoRetry(
    () => readFileImpl(manifestPath, "utf8"),
    { retryCount, retryDelayMs },
  ));
  return {
    ...manifest,
    items: Array.isArray(manifest?.items) ? manifest.items.map((item) => normalizeManifestItem(item)) : [],
  };
}

export async function saveManifest(manifestPath, manifest, {
  mkdirImpl = mkdir,
  writeFileImpl = writeFile,
  retryCount = DEFAULT_MANIFEST_IO_RETRY_COUNT,
  retryDelayMs = DEFAULT_MANIFEST_IO_RETRY_DELAY_MS,
} = {}) {
  await mkdirImpl(dirname(manifestPath), { recursive: true });
  await withManifestIoRetry(
    () => writeFileImpl(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    { retryCount, retryDelayMs },
  );
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

export function summarizeManifestMetadata(manifest) {
  const counts = {
    total: 0,
    pending: 0,
    success: 0,
    failed: 0,
    withTags: 0,
  };
  for (const item of Array.isArray(manifest?.items) ? manifest.items : []) {
    counts.total += 1;
    if (Array.isArray(item?.tags) && item.tags.length > 0) {
      counts.withTags += 1;
    }
    if (item?.metadataStatus === "success") {
      counts.success += 1;
    } else if (item?.metadataStatus === "failed") {
      counts.failed += 1;
    } else {
      counts.pending += 1;
    }
  }
  return counts;
}

export async function loadManifestMetadataSummary(manifestPath) {
  return summarizeManifestMetadata(await loadManifest(manifestPath));
}

export async function createManifest({ manifestPath, family, items, outputDir }) {
  const hydratedItems = hydrateManifestItems(items, { outputDir });
  const manifest = {
    family,
    generatedAt: new Date().toISOString(),
    items: hydratedItems.map((item) => normalizeManifestItem({
      itemId: item.itemId,
      slug: item.slug,
      hash: item.hash,
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
    updateItem(manifest, { itemId, slug }, (item) => normalizeManifestItem({
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
    updateItem(manifest, { itemId, slug }, (item) => normalizeManifestItem({
      ...item,
      status: "failed",
      attempts: (item.attempts ?? 0) + 1,
      error,
    })),
  );
}

export async function updateManifestItemMetadata({
  manifestPath,
  itemId,
  slug,
  tags,
  metadataStatus,
  metadataError = null,
  metadataUpdatedAt,
}) {
  const manifest = await loadManifest(manifestPath);
  await saveManifest(
    manifestPath,
    updateItem(manifest, { itemId, slug }, (item) => normalizeManifestItem({
      ...item,
      tags,
      metadataStatus,
      metadataError,
      metadataUpdatedAt,
    })),
  );
}

export async function updateManifestItemsMetadataBatch({
  manifestPath,
  updates,
} = {}) {
  const metadataUpdates = Array.isArray(updates) ? updates.filter(Boolean) : [];
  if (!manifestPath) {
    throw new Error("updateManifestItemsMetadataBatch requires manifestPath");
  }
  if (!metadataUpdates.length) {
    return;
  }

  const manifest = await loadManifest(manifestPath);
  let nextManifest = manifest;

  for (const update of metadataUpdates) {
    nextManifest = updateItem(nextManifest, {
      itemId: update.itemId,
      slug: update.slug,
    }, (item) => normalizeManifestItem({
      ...item,
      tags: update.tags,
      metadataStatus: update.metadataStatus,
      metadataError: update.metadataError ?? null,
      metadataUpdatedAt: update.metadataUpdatedAt,
    }));
  }

  await saveManifest(manifestPath, nextManifest);
}
