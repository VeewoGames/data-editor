import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadManifest,
  updateManifestItemMetadata,
  updateManifestItemsMetadataBatch,
} from "./lib/manifest-store.mjs";
import {
  buildManifestMetadataUpdatePayload,
  selectManifestMetadataCandidateItems,
} from "./lib/streamline-metadata-manifest.mjs";
import { parseStreamlineDetailMetadataRecord } from "./lib/streamline-detail-metadata.mjs";

async function readCurrentDetailStateSource(tab) {
  return tab.playwright.evaluate(
    () => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
      const matched = scripts.find((node) => {
        const text = node.textContent ?? "";
        return text.includes("streamlineApi") && text.includes("getIconDetailsBySlugAndSubcategoryId");
      });
      return matched?.textContent ?? document.documentElement.outerHTML;
    },
    undefined,
    { timeoutMs: 10_000 },
  );
}

function resolveDelayValue(value, fallback = 0) {
  if (value == null) {
    return fallback;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Delay value must be a non-negative finite number, received: ${value}`);
  }
  return Math.trunc(value);
}

function resolveJitteredDelay({
  baseMs = 0,
  jitterMs = 0,
  random = Math.random,
} = {}) {
  const resolvedBaseMs = resolveDelayValue(baseMs);
  const resolvedJitterMs = resolveDelayValue(jitterMs);
  if (resolvedJitterMs === 0) {
    return resolvedBaseMs;
  }
  if (typeof random !== "function") {
    throw new Error("resolveJitteredDelay requires random to be a function");
  }

  const sample = Number(random());
  const normalizedSample = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1) : 0;
  return resolvedBaseMs + Math.round(normalizedSample * resolvedJitterMs);
}

async function waitForDelay(tab, delayMs) {
  if (delayMs <= 0) {
    return;
  }
  await tab.playwright.waitForTimeout(delayMs);
}

async function extractMetadataForManifestItem({
  item,
  tab,
  waitMs,
  postLoadJitterMs = 0,
  preNavigationDelayMs = 0,
  preNavigationJitterMs = 0,
  random = Math.random,
} = {}) {
  await waitForDelay(tab, resolveJitteredDelay({
    baseMs: preNavigationDelayMs,
    jitterMs: preNavigationJitterMs,
    random,
  }));
  await tab.goto(item.iconUrl);
  await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 20_000 });
  await waitForDelay(tab, resolveJitteredDelay({
    baseMs: waitMs,
    jitterMs: postLoadJitterMs,
    random,
  }));
  const source = await readCurrentDetailStateSource(tab);
  const record = parseStreamlineDetailMetadataRecord(source, {
    iconUrl: item.iconUrl,
    slug: item.slug,
  });

  return {
    itemId: item.itemId ?? item.slug,
    slug: item.slug,
    ok: true,
    tags: record.tags,
  };
}

export async function runManifestMetadataExtraction({
  manifestPath,
  tab,
  waitMs = 500,
  postLoadJitterMs = 0,
  preNavigationDelayMs = 0,
  preNavigationJitterMs = 0,
  postItemDelayMs = 0,
  postItemJitterMs = 0,
  maxItems,
  force = false,
  retryFailed = false,
  itemIds,
  cleanupAfterItem,
  random = Math.random,
} = {}) {
  if (!manifestPath || !tab) {
    throw new Error("runManifestMetadataExtraction requires manifestPath and tab");
  }

  const manifest = await loadManifest(manifestPath);
  const selectedItems = selectManifestMetadataCandidateItems(manifest.items, {
    force,
    retryFailed,
    maxItems,
    itemIds,
  });
  const results = [];

  for (const item of selectedItems) {
    try {
      const result = await extractMetadataForManifestItem({
        item,
        tab,
        waitMs,
        postLoadJitterMs,
        preNavigationDelayMs,
        preNavigationJitterMs,
        random,
      });

      await updateManifestItemMetadata({
        manifestPath,
        ...buildManifestMetadataUpdatePayload(result, item),
      });

      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const result = {
        itemId: item.itemId ?? item.slug,
        slug: item.slug,
        ok: false,
        error: message,
      };
      await updateManifestItemMetadata({
        manifestPath,
        ...buildManifestMetadataUpdatePayload(result, item),
      });
      results.push(result);
    } finally {
      if (typeof cleanupAfterItem === "function") {
        await cleanupAfterItem(item).catch(() => {});
      }
      await waitForDelay(tab, resolveJitteredDelay({
        baseMs: postItemDelayMs,
        jitterMs: postItemJitterMs,
        random,
      }));
    }
  }

  return {
    family: manifest.family,
    total: selectedItems.length,
    success: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
}

export async function runManifestMetadataExtractionParallel({
  manifestPath,
  tabs,
  waitMs = 500,
  maxItems,
  force = false,
  retryFailed = false,
  itemIds,
  cleanupAfterItem,
} = {}) {
  const workerTabs = Array.isArray(tabs) ? tabs.filter(Boolean) : [];
  if (!manifestPath || workerTabs.length === 0) {
    throw new Error("runManifestMetadataExtractionParallel requires manifestPath and at least one tab");
  }

  const manifest = await loadManifest(manifestPath);
  const selectedItems = selectManifestMetadataCandidateItems(manifest.items, {
    force,
    retryFailed,
    maxItems,
    itemIds,
  });
  const results = [];

  for (let offset = 0; offset < selectedItems.length; offset += workerTabs.length) {
    const chunk = selectedItems.slice(offset, offset + workerTabs.length);
    const chunkResults = await Promise.all(chunk.map(async (item, index) => {
      try {
        return await extractMetadataForManifestItem({
          item,
          tab: workerTabs[index],
          waitMs,
        });
      } catch (error) {
        return {
          itemId: item.itemId ?? item.slug,
          slug: item.slug,
          ok: false,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        };
      } finally {
        if (typeof cleanupAfterItem === "function") {
          await cleanupAfterItem(item).catch(() => {});
        }
      }
    }));

    await updateManifestItemsMetadataBatch({
      manifestPath,
      updates: chunkResults.map((result, index) => buildManifestMetadataUpdatePayload(result, chunk[index])),
    });
    results.push(...chunkResults);
  }

  return {
    family: manifest.family,
    total: selectedItems.length,
    success: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
}

async function main(argv) {
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const manifestPath = argv[2] ? resolve(projectRoot, argv[2]) : "";
  if (!manifestPath) {
    throw new Error("Usage: node scripts/streamline-export/extract-streamline-detail-metadata.mjs <manifestPath>");
  }

  console.log(JSON.stringify({
    manifestPath,
    message: "Use runManifestMetadataExtraction({ manifestPath, tab }) from a Chrome browser session runner.",
  }, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("extract-streamline-detail-metadata.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
