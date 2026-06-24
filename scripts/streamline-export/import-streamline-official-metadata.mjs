import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, updateManifestItemsMetadataBatch } from "./lib/manifest-store.mjs";
import {
  buildManifestMetadataUpdatePayload,
  selectManifestMetadataCandidateItems,
} from "./lib/streamline-metadata-manifest.mjs";
import {
  indexOfficialMetadataRecords,
  resolveOfficialMetadataForManifestItem,
} from "./lib/streamline-official-metadata-source.mjs";

function parseCliArgs(argv) {
  const options = {
    manifestPath: "",
    metadataPath: "",
    maxItems: undefined,
    force: false,
    retryFailed: false,
  };

  const positional = [];
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--force") {
      options.force = true;
      continue;
    }
    if (value === "--retry-failed") {
      options.retryFailed = true;
      continue;
    }
    if (value === "--max-items") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("--max-items requires a value");
      }
      options.maxItems = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }
    positional.push(value);
  }

  options.manifestPath = positional[0] ? resolve(positional[0]) : "";
  options.metadataPath = positional[1] ? resolve(positional[1]) : "";
  return options;
}

async function loadOfficialMetadataRecords(metadataPath) {
  const payload = JSON.parse(await readFile(metadataPath, "utf8"));
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  throw new Error("Official metadata payload must be a JSON array or an object with an items array");
}

export async function importOfficialMetadataIntoManifest({
  manifestPath,
  metadataPath,
  maxItems,
  force = false,
  retryFailed = false,
} = {}) {
  if (!manifestPath || !metadataPath) {
    throw new Error("importOfficialMetadataIntoManifest requires manifestPath and metadataPath");
  }

  const manifest = await loadManifest(manifestPath);
  const records = await loadOfficialMetadataRecords(metadataPath);
  const index = indexOfficialMetadataRecords(records);
  const selectedItems = selectManifestMetadataCandidateItems(manifest.items, {
    force,
    retryFailed,
    maxItems,
  });

  const results = selectedItems.map((item) => {
    const matched = resolveOfficialMetadataForManifestItem(index, item);
    if (!matched) {
      return {
        itemId: item.itemId ?? item.slug,
        slug: item.slug,
        ok: false,
        error: item?.hash
          ? `Official metadata not found for hash ${item.hash}`
          : `Official metadata not found for slug ${item.slug}`,
      };
    }

    return {
      itemId: item.itemId ?? item.slug,
      slug: item.slug,
      ok: true,
      tags: matched.tags,
      matchedBy: matched.matchedBy,
    };
  });

  await updateManifestItemsMetadataBatch({
    manifestPath,
    updates: results.map((result, index) => buildManifestMetadataUpdatePayload(result, selectedItems[index])),
  });

  return {
    family: manifest.family,
    total: selectedItems.length,
    success: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    matchedByHash: results.filter((item) => item.ok && item.matchedBy === "hash").length,
    matchedBySlug: results.filter((item) => item.ok && item.matchedBy === "slug").length,
    results,
  };
}

async function main(argv) {
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const parsed = parseCliArgs(argv);
  const manifestPath = parsed.manifestPath ? resolve(projectRoot, parsed.manifestPath) : "";
  const metadataPath = parsed.metadataPath ? resolve(projectRoot, parsed.metadataPath) : "";
  if (!manifestPath || !metadataPath) {
    throw new Error("Usage: node scripts/streamline-export/import-streamline-official-metadata.mjs <manifestPath> <metadataPath> [--max-items <n>] [--force] [--retry-failed]");
  }

  const result = await importOfficialMetadataIntoManifest({
    manifestPath,
    metadataPath,
    maxItems: parsed.maxItems,
    force: parsed.force,
    retryFailed: parsed.retryFailed,
  });

  console.log(JSON.stringify({
    manifestPath,
    metadataPath,
    ...result,
  }, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("import-streamline-official-metadata.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
