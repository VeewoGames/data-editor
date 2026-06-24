import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadManifest, saveManifest } from "./lib/manifest-store.mjs";

function buildAbsoluteIconUrl(url) {
  const value = String(url ?? "").trim();
  if (!value) {
    return "";
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return `https://www.streamlinehq.com${value}`;
}

function buildHashIndex(items) {
  const byIconUrl = new Map();
  const bySlug = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const hash = typeof item?.hash === "string" ? item.hash.trim() : "";
    const slug = typeof item?.slug === "string" ? item.slug.trim() : "";
    const iconUrl = buildAbsoluteIconUrl(item?.iconUrl ?? item?.url);
    if (!hash || !slug) {
      continue;
    }
    if (iconUrl) {
      byIconUrl.set(iconUrl, hash);
    }
    if (!bySlug.has(slug)) {
      bySlug.set(slug, hash);
    }
  }

  return { byIconUrl, bySlug };
}

async function importManifestHashesFromItems({
  manifestPath,
  itemsPath,
} = {}) {
  if (!manifestPath || !itemsPath) {
    throw new Error("importManifestHashesFromItems requires manifestPath and itemsPath");
  }

  const [manifest, items] = await Promise.all([
    loadManifest(manifestPath),
    readFile(itemsPath, "utf8").then((text) => JSON.parse(text)),
  ]);

  const hashIndex = buildHashIndex(items);
  let updated = 0;
  let matchedByUrl = 0;
  let matchedBySlug = 0;

  const nextManifest = {
    ...manifest,
    items: manifest.items.map((item) => {
      if (typeof item?.hash === "string" && item.hash.trim()) {
        return item;
      }

      const iconUrl = String(item?.iconUrl ?? "").trim();
      const slug = String(item?.slug ?? "").trim();
      const hashFromUrl = iconUrl ? hashIndex.byIconUrl.get(iconUrl) : null;
      const hashFromSlug = !hashFromUrl && slug ? hashIndex.bySlug.get(slug) : null;
      const nextHash = hashFromUrl ?? hashFromSlug ?? null;

      if (!nextHash) {
        return item;
      }

      updated += 1;
      if (hashFromUrl) {
        matchedByUrl += 1;
      } else {
        matchedBySlug += 1;
      }

      return {
        ...item,
        hash: nextHash,
      };
    }),
  };

  await saveManifest(manifestPath, nextManifest);
  return {
    manifestPath,
    itemsPath,
    total: manifest.items.length,
    updated,
    matchedByUrl,
    matchedBySlug,
    unmatched: manifest.items.length - updated,
  };
}

async function main(argv) {
  const manifestPath = argv[2] ? resolve(argv[2]) : "";
  const itemsPath = argv[3] ? resolve(argv[3]) : "";
  if (!manifestPath || !itemsPath) {
    throw new Error("Usage: node scripts/streamline-export/import-streamline-item-hashes.mjs <manifestPath> <itemsPath>");
  }

  const result = await importManifestHashesFromItems({
    manifestPath,
    itemsPath,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("import-streamline-item-hashes.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export {
  buildAbsoluteIconUrl,
  buildHashIndex,
  importManifestHashesFromItems,
};
