import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, saveManifest } from "./lib/manifest-store.mjs";

const defaultApiBaseUrl = "https://public-api.streamlinehq.com";

async function fetchFamilyIconsPage({
  familyHash,
  apiKey,
  offset = 0,
  limit = 100,
  apiBaseUrl = defaultApiBaseUrl,
  fetchImpl = fetch,
} = {}) {
  const url = new URL(`/v1/families/${familyHash}/icons`, apiBaseUrl);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));

  const response = await fetchImpl(url, {
    headers: {
      "x-api-key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch family icons: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function fetchAllFamilyIcons({
  familyHash,
  apiKey,
  pageSize = 100,
  apiBaseUrl = defaultApiBaseUrl,
  fetchImpl = fetch,
} = {}) {
  if (!familyHash || !apiKey) {
    throw new Error("fetchAllFamilyIcons requires familyHash and apiKey");
  }

  const icons = [];
  let offset = 0;

  while (true) {
    const payload = await fetchFamilyIconsPage({
      familyHash,
      apiKey,
      offset,
      limit: pageSize,
      apiBaseUrl,
      fetchImpl,
    });
    const pageIcons = Array.isArray(payload?.icons) ? payload.icons : [];
    icons.push(...pageIcons);
    const nextOffset = Number(payload?.pagination?.nextOffset ?? 0);
    const hasMore = Boolean(payload?.pagination?.hasMore);
    if (!hasMore || !pageIcons.length) {
      break;
    }
    offset = nextOffset;
  }

  return icons;
}

export async function hydrateManifestHashesFromFamily({
  manifestPath,
  familyHash,
  apiKey,
  pageSize = 100,
  apiBaseUrl = defaultApiBaseUrl,
  fetchImpl = fetch,
} = {}) {
  if (!manifestPath || !familyHash || !apiKey) {
    throw new Error("hydrateManifestHashesFromFamily requires manifestPath, familyHash, and apiKey");
  }

  const [manifest, familyIcons] = await Promise.all([
    loadManifest(manifestPath),
    fetchAllFamilyIcons({
      familyHash,
      apiKey,
      pageSize,
      apiBaseUrl,
      fetchImpl,
    }),
  ]);

  const iconsByWebUrl = new Map();
  for (const icon of familyIcons) {
    const webUrl = typeof icon?.webUrl === "string" ? icon.webUrl.trim() : "";
    if (webUrl) {
      iconsByWebUrl.set(webUrl, icon);
    }
  }

  let matched = 0;
  let updated = 0;
  const nextManifest = {
    ...manifest,
    items: Array.isArray(manifest.items) ? manifest.items.map((item) => {
      const webUrl = typeof item?.iconUrl === "string" ? item.iconUrl.trim() : "";
      const matchedIcon = iconsByWebUrl.get(webUrl);
      if (!matchedIcon) {
        return item;
      }
      matched += 1;
      const nextHash = typeof matchedIcon.hash === "string" ? matchedIcon.hash.trim() : "";
      if (!nextHash || item?.hash === nextHash) {
        return item;
      }
      updated += 1;
      return {
        ...item,
        hash: nextHash,
      };
    }) : [],
  };

  await saveManifest(manifestPath, nextManifest);

  return {
    manifestPath,
    familyHash,
    fetched: familyIcons.length,
    matched,
    updated,
    unmatched: (Array.isArray(manifest.items) ? manifest.items.length : 0) - matched,
  };
}

function parseCliArgs(argv) {
  const positional = argv.slice(2).filter(Boolean);
  return {
    manifestPath: positional[0] ? resolve(positional[0]) : "",
    familyHash: positional[1] ?? "",
    apiKey: process.env.STREAMLINE_API_KEY ?? "",
  };
}

async function main(argv) {
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const parsed = parseCliArgs(argv);
  const manifestPath = parsed.manifestPath ? resolve(projectRoot, parsed.manifestPath) : "";
  if (!manifestPath || !parsed.familyHash) {
    throw new Error("Usage: STREAMLINE_API_KEY=<key> node scripts/streamline-export/hydrate-streamline-manifest-hashes.mjs <manifestPath> <familyHash>");
  }
  if (!parsed.apiKey) {
    throw new Error("STREAMLINE_API_KEY is required");
  }

  const result = await hydrateManifestHashesFromFamily({
    manifestPath,
    familyHash: parsed.familyHash,
    apiKey: parsed.apiKey,
  });

  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("hydrate-streamline-manifest-hashes.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
