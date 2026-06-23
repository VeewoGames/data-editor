import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { normalizeIconSlugToFilename } from "./normalize-name.mjs";

export async function loadManifest(manifestPath) {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

export async function saveManifest(manifestPath, manifest) {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function createManifest({ manifestPath, family, items, outputDir }) {
  const manifest = {
    family,
    generatedAt: new Date().toISOString(),
    items: items.map((item) => ({
      slug: item.slug,
      name: item.name,
      iconUrl: item.iconUrl,
      status: "pending",
      attempts: 0,
      outputPath: join(outputDir, normalizeIconSlugToFilename(item.slug)).replace(/\\/g, "/"),
      error: null,
      extractedAt: null,
    })),
  };
  await saveManifest(manifestPath, manifest);
}

function updateItem(manifest, slug, updater) {
  let found = false;
  const items = manifest.items.map((item) => {
    if (item.slug !== slug) return item;
    found = true;
    return updater(item);
  });
  if (!found) {
    throw new Error(`Manifest item not found: ${slug}`);
  }
  return { ...manifest, items };
}

export async function markManifestItemSuccess({ manifestPath, slug, extractedAt }) {
  const manifest = await loadManifest(manifestPath);
  await saveManifest(
    manifestPath,
    updateItem(manifest, slug, (item) => ({
      ...item,
      status: "success",
      error: null,
      extractedAt,
    })),
  );
}

export async function markManifestItemFailed({ manifestPath, slug, error }) {
  const manifest = await loadManifest(manifestPath);
  await saveManifest(
    manifestPath,
    updateItem(manifest, slug, (item) => ({
      ...item,
      status: "failed",
      attempts: (item.attempts ?? 0) + 1,
      error,
    })),
  );
}
