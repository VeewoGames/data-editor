import { resolve } from "node:path";
import {
  loadManifest,
  markManifestItemFailed,
  markManifestItemSuccess,
} from "./lib/manifest-store.mjs";
import { writeSvgFile } from "./lib/file-writer.mjs";

export async function extractCurrentIconSvgFromTab(tab, { attempts = 20, waitMs = 500 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const extracted = await tab.playwright.evaluate(() => {
      const previewRoot = document.querySelector('[data-sentry-component="EditionPanelPreviewSection"] [role="img"]');
      const svg = previewRoot?.querySelector("svg") ?? null;
      if (!svg) return null;
      return {
        ariaLabel: previewRoot?.getAttribute("aria-label") ?? null,
        svgOuterHTML: String(svg.outerHTML ?? ""),
      };
    }, undefined, { timeoutMs: 10_000 });

    if (extracted?.svgOuterHTML) {
      return extracted;
    }

    if (attempt < attempts - 1) {
      await tab.playwright.waitForTimeout(waitMs);
    }
  }

  throw new Error("preview-svg-not-found-after-wait");
}

export async function runManifestExtraction({
  manifestPath,
  tab,
  attempts = 20,
  waitMs = 500,
  itemRetries = 2,
} = {}) {
  if (!manifestPath || !tab) {
    throw new Error("runManifestExtraction requires manifestPath and tab");
  }

  const manifest = await loadManifest(manifestPath);
  const pendingItems = manifest.items.filter((item) => item.status !== "success");
  const results = [];

  for (const item of pendingItems) {
    try {
      let extracted = null;
      let lastError = null;
      for (let itemAttempt = 0; itemAttempt < itemRetries; itemAttempt += 1) {
        try {
          await tab.goto(item.iconUrl);
          await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 20_000 });
          extracted = await extractCurrentIconSvgFromTab(tab, { attempts, waitMs });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!extracted?.svgOuterHTML) {
        throw lastError ?? new Error("preview-svg-not-found-after-wait");
      }

      await writeSvgFile(resolve(item.outputPath), extracted.svgOuterHTML);
      await markManifestItemSuccess({
        manifestPath,
        slug: item.slug,
        extractedAt: new Date().toISOString(),
      });
      results.push({
        slug: item.slug,
        ok: true,
        outputPath: item.outputPath,
        ariaLabel: extracted.ariaLabel,
      });
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      await markManifestItemFailed({
        manifestPath,
        slug: item.slug,
        error: message,
      });
      results.push({
        slug: item.slug,
        ok: false,
        error: message,
      });
    }
  }

  return {
    family: manifest.family,
    total: pendingItems.length,
    success: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
}

async function main(argv) {
  const manifestPath = argv[2];
  if (!manifestPath) {
    throw new Error("Usage: node extract-streamline-svg-dom.mjs <manifestPath>");
  }

  console.log(JSON.stringify({
    family: (await loadManifest(manifestPath)).family,
    note: "Use runManifestExtraction({ manifestPath, tab }) from a Chrome browser session runner.",
  }, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("extract-streamline-svg-dom.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
