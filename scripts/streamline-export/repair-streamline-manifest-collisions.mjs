import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hydrateManifestItems, loadManifest, saveManifest } from "./lib/manifest-store.mjs";

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function buildCollisionUrlSets(items) {
  const map = new Map();
  for (const item of items) {
    const slug = String(item?.slug ?? "").trim();
    if (!slug) continue;
    const urls = map.get(slug) ?? new Set();
    const iconUrl = String(item?.iconUrl ?? "").trim();
    if (iconUrl) {
      urls.add(iconUrl);
    }
    map.set(slug, urls);
  }
  return map;
}

export async function repairStreamlineManifestCollisions({ manifestPath } = {}) {
  if (!manifestPath) {
    throw new Error("repairStreamlineManifestCollisions requires manifestPath");
  }

  const manifest = await loadManifest(manifestPath);
  const outputDir = dirname(String(manifest.items?.[0]?.outputPath ?? ""));
  const hydratedItems = hydrateManifestItems(manifest.items, { outputDir });
  const uniqueUrlsBySlug = buildCollisionUrlSets(hydratedItems);

  let changedItems = 0;
  let resetToPending = 0;
  const repairedItems = [];

  for (let index = 0; index < hydratedItems.length; index += 1) {
    const previous = manifest.items[index];
    const next = { ...hydratedItems[index] };
    const hasVariantCollision = (uniqueUrlsBySlug.get(next.slug)?.size ?? 0) > 1;
    const metadataChanged =
      previous?.itemId !== next.itemId ||
      previous?.sourceId !== next.sourceId ||
      previous?.outputPath !== next.outputPath;

    if (metadataChanged) {
      changedItems += 1;
    }

    if (hasVariantCollision) {
      const targetExists = await exists(next.outputPath);
      if (!targetExists) {
        next.status = "pending";
        next.error = null;
        next.extractedAt = null;
        resetToPending += 1;
      }
    }

    repairedItems.push(next);
  }

  const repairedManifest = {
    ...manifest,
    items: repairedItems,
  };
  await saveManifest(manifestPath, repairedManifest);

  return {
    manifestPath,
    changedItems,
    resetToPending,
    total: repairedItems.length,
  };
}

async function main(argv) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const manifestPaths = argv.slice(2).filter(Boolean).map((value) => resolve(projectRoot, value));
  if (!manifestPaths.length) {
    throw new Error("Usage: node scripts/streamline-export/repair-streamline-manifest-collisions.mjs <manifestPath...>");
  }

  const results = [];
  for (const manifestPath of manifestPaths) {
    const result = await repairStreamlineManifestCollisions({ manifestPath });
    results.push({
      ...result,
      manifestPath: relative(projectRoot, result.manifestPath).replace(/\\/g, "/"),
    });
  }

  console.log(JSON.stringify({ results }, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("repair-streamline-manifest-collisions.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
