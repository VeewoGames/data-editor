import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, updateManifestItemsMetadataBatch } from "./lib/manifest-store.mjs";
import {
  buildManifestMetadataUpdatePayload,
} from "./lib/streamline-metadata-manifest.mjs";
import { parseStreamlineDetailMetadataRecord } from "./lib/streamline-detail-metadata.mjs";

function parseCliArgs(argv) {
  const positional = argv.slice(2).filter(Boolean);
  return {
    manifestPath: positional[0] ? resolve(positional[0]) : "",
    sourcePath: positional[1] ? resolve(positional[1]) : "",
  };
}

async function loadCapturedSources(sourcePath) {
  const payload = JSON.parse(await readFile(sourcePath, "utf8"));
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  throw new Error("Captured detail source payload must be a JSON array or an object with an items array");
}

function normalizeCapturedSourceItem(item) {
  const iconUrl = typeof item?.iconUrl === "string" ? item.iconUrl.trim() : "";
  const slug = typeof item?.slug === "string" ? item.slug.trim() : "";
  const source = typeof item?.source === "string"
    ? item.source
    : typeof item?.html === "string"
      ? item.html
      : typeof item?.text === "string"
        ? item.text
        : "";

  if (!iconUrl || !slug || !source) {
    throw new Error("Captured detail source item requires iconUrl, slug, and source/html/text");
  }

  return {
    iconUrl,
    slug,
    source,
  };
}

export async function importStreamlineDetailSourceMetadata({
  manifestPath,
  sourcePath,
} = {}) {
  if (!manifestPath || !sourcePath) {
    throw new Error("importStreamlineDetailSourceMetadata requires manifestPath and sourcePath");
  }

  const [manifest, capturedItems] = await Promise.all([
    loadManifest(manifestPath),
    loadCapturedSources(sourcePath),
  ]);

  const manifestItemsByIconUrl = new Map(
    (Array.isArray(manifest.items) ? manifest.items : [])
      .filter((item) => typeof item?.iconUrl === "string" && item.iconUrl.trim())
      .map((item) => [item.iconUrl.trim(), item]),
  );

  const updates = [];
  const results = [];
  for (const rawItem of capturedItems) {
    try {
      const normalized = normalizeCapturedSourceItem(rawItem);
      const manifestItem = manifestItemsByIconUrl.get(normalized.iconUrl);
      if (!manifestItem) {
        results.push({
          iconUrl: normalized.iconUrl,
          slug: normalized.slug,
          ok: false,
          error: `Manifest item not found for iconUrl ${normalized.iconUrl}`,
        });
        continue;
      }

      const record = parseStreamlineDetailMetadataRecord(normalized.source, {
        iconUrl: normalized.iconUrl,
        slug: normalized.slug,
      });
      const result = {
        itemId: manifestItem.itemId ?? manifestItem.slug,
        slug: manifestItem.slug,
        ok: true,
        tags: record.tags,
      };
      updates.push(buildManifestMetadataUpdatePayload(result, manifestItem));
      results.push({
        iconUrl: normalized.iconUrl,
        slug: normalized.slug,
        ok: true,
        tags: record.tags,
      });
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      results.push({
        iconUrl: rawItem?.iconUrl ?? null,
        slug: rawItem?.slug ?? null,
        ok: false,
        error: message,
      });
    }
  }

  if (updates.length) {
    await updateManifestItemsMetadataBatch({
      manifestPath,
      updates,
    });
  }

  return {
    family: manifest.family,
    total: results.length,
    success: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
}

async function main(argv) {
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const parsed = parseCliArgs(argv);
  const manifestPath = parsed.manifestPath ? resolve(projectRoot, parsed.manifestPath) : "";
  const sourcePath = parsed.sourcePath ? resolve(projectRoot, parsed.sourcePath) : "";
  if (!manifestPath || !sourcePath) {
    throw new Error("Usage: node scripts/streamline-export/import-streamline-detail-source-metadata.mjs <manifestPath> <sourcePath>");
  }

  const result = await importStreamlineDetailSourceMetadata({
    manifestPath,
    sourcePath,
  });

  console.log(JSON.stringify({
    manifestPath,
    sourcePath,
    ...result,
  }, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("import-streamline-detail-source-metadata.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
