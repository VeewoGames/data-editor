import { resolve } from "node:path";
import {
  loadManifest,
  markManifestItemFailed,
  markManifestItemSuccess,
} from "./lib/manifest-store.mjs";
import { writeSvgFile } from "./lib/file-writer.mjs";

function isSvgText(value) {
  return typeof value === "string" && value.trimStart().startsWith("<svg");
}

class StreamlineQuotaExceededError extends Error {
  constructor(message = "streamline-weekly-download-quota-exhausted") {
    super(message);
    this.name = "StreamlineQuotaExceededError";
  }
}

async function inspectQuotaState(tab) {
  return tab.playwright.evaluate(() => {
    const text = document.body?.innerText ?? "";
    const normalized = text.replace(/\s+/g, " ").trim();
    const quotaExceeded =
      normalized.includes("100% of your weekly downloads used") ||
      (
        normalized.includes("weekly exports") &&
        normalized.includes("Please come back next week to continue downloading")
      );
    return {
      quotaExceeded,
      text: quotaExceeded ? normalized : null,
    };
  }, undefined, { timeoutMs: 10_000 });
}

async function assertNoQuotaExceeded(tab) {
  const quotaState = await inspectQuotaState(tab);
  if (quotaState?.quotaExceeded) {
    throw new StreamlineQuotaExceededError(
      quotaState.text ?? "streamline-weekly-download-quota-exhausted",
    );
  }
}

async function inspectPreviewState(tab) {
  return tab.playwright.evaluate(() => {
    const previewRoot =
      document.querySelector('[data-sentry-component="EditionPanelPreviewSection"] [role="img"]') ??
      document.querySelector('[data-sentry-component="EditionPanelPreviewSection"]') ??
      null;
    const svg = previewRoot?.querySelector("svg") ?? null;
    const image = previewRoot?.querySelector("img") ?? null;
    return {
      ariaLabel: previewRoot?.getAttribute("aria-label") ?? null,
      hasPreviewRoot: Boolean(previewRoot),
      hasImagePreview: Boolean(image),
      svgOuterHTML: svg ? String(svg.outerHTML ?? "") : null,
    };
  }, undefined, { timeoutMs: 10_000 });
}

async function getCurrentPageUrl(tab) {
  if (typeof tab?.url === "function") {
    return tab.url();
  }
  return null;
}

function isPricingUrl(url) {
  return typeof url === "string" && url.includes("home.streamlinehq.com/pricing");
}

function isProfileUrl(url) {
  return typeof url === "string" && url.includes("www.streamlinehq.com/profile");
}

function isStreamlineDownloadUrl(url) {
  return typeof url === "string" && url.includes("streamlinehq.com/icons/download/");
}

async function assertStreamlineDetailPage(tab, expectedUrl) {
  const currentUrl = await getCurrentPageUrl(tab);
  if (isPricingUrl(currentUrl)) {
    throw new Error(`streamline-redirected-to-pricing: ${currentUrl}`);
  }
  if (isProfileUrl(currentUrl)) {
    throw new Error(`streamline-redirected-to-profile: ${currentUrl}`);
  }
  if (currentUrl && expectedUrl && currentUrl !== expectedUrl && !isStreamlineDownloadUrl(currentUrl)) {
    throw new Error(`streamline-unexpected-url: ${currentUrl}`);
  }
  await assertNoQuotaExceeded(tab);
}

async function ensureExportFormat(tab, targetFormat = "SVG") {
  const playwright = tab?.playwright;
  if (!playwright?.evaluate || !playwright?.locator || !playwright?.getByRole) {
    return false;
  }

  const currentFormat = await playwright.evaluate(() => (
    document
      .querySelector('[data-sentry-component="EditionPanelExportSectionFormatChooseNew"] button[aria-haspopup="listbox"] span')
      ?.textContent
      ?.trim() ?? null
  ), undefined, { timeoutMs: 10_000 });

  if (currentFormat === targetFormat) {
    return true;
  }

  const formatButton = playwright.locator('[data-sentry-component="EditionPanelExportSectionFormatChooseNew"] button[aria-haspopup="listbox"]');
  if (await formatButton.count() !== 1) {
    return false;
  }
  await formatButton.click();

  const targetOption = playwright.getByRole("option", { name: targetFormat });
  if (await targetOption.count() !== 1) {
    return false;
  }
  await targetOption.click();

  const selectedFormat = await playwright.evaluate(() => (
    document
      .querySelector('[data-sentry-component="EditionPanelExportSectionFormatChooseNew"] button[aria-haspopup="listbox"] span')
      ?.textContent
      ?.trim() ?? null
  ), undefined, { timeoutMs: 10_000 });

  return selectedFormat === targetFormat;
}

async function waitForExportControls(tab, { attempts = 10, waitMs = 300 } = {}) {
  const playwright = tab?.playwright;
  if (!playwright?.evaluate || !playwright?.waitForTimeout) {
    return false;
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await assertNoQuotaExceeded(tab);
    const ready = await playwright.evaluate(() => {
      const formatButton = document.querySelector(
        '[data-sentry-component="EditionPanelExportSectionFormatChooseNew"] button[aria-haspopup="listbox"]',
      );
      const copyButton = Array.from(document.querySelectorAll("button"))
        .find((element) => element.textContent?.trim() === "Copy");
      return Boolean(formatButton && copyButton);
    }, undefined, { timeoutMs: 10_000 });

    if (ready) {
      return true;
    }

    if (attempt < attempts - 1) {
      await playwright.waitForTimeout(waitMs);
    }
  }

  return false;
}

async function clickCopyButton(tab) {
  const playwright = tab?.playwright;
  const cua = tab?.cua;
  if (!playwright?.evaluate) {
    return false;
  }
  await assertNoQuotaExceeded(tab);

  const buttonRect = await playwright.evaluate(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((element) => element.textContent?.trim() === "Copy");
    if (!button) {
      return null;
    }
    const rect = button.getBoundingClientRect();
    return {
      x: rect.left + (rect.width / 2),
      y: rect.top + (rect.height / 2),
    };
  }, undefined, { timeoutMs: 10_000 });

  if (buttonRect && cua?.click) {
    await cua.click(buttonRect);
    return true;
  }

  const copyButton = playwright.getByText?.("Copy", { exact: true });
  if (!copyButton?.count || !copyButton?.click) {
    return false;
  }
  if (await copyButton.count() !== 1) {
    return false;
  }
  await copyButton.click();
  return true;
}

async function extractCurrentIconSvgFromClipboard(tab, { attempts = 4, waitMs = 400, pollRounds = 4 } = {}) {
  if (!tab?.clipboard?.readText || !tab?.clipboard?.writeText) {
    return null;
  }
  await assertNoQuotaExceeded(tab);
  const exportReady = await waitForExportControls(tab, { attempts: 10, waitMs });
  if (!exportReady) {
    return null;
  }
  await ensureExportFormat(tab, "SVG");
  await tab.clipboard.writeText("");

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const clicked = await clickCopyButton(tab);
    if (!clicked) {
      return null;
    }

    for (let pollAttempt = 0; pollAttempt < pollRounds; pollAttempt += 1) {
      await tab.playwright.waitForTimeout(waitMs);
      await assertNoQuotaExceeded(tab);
      const svgText = await tab.clipboard.readText();
      if (isSvgText(svgText)) {
        return {
          ariaLabel: null,
          svgOuterHTML: svgText,
        };
      }
    }
  }

  return null;
}

export async function extractCurrentIconSvgFromTab(tab, { attempts = 20, waitMs = 500 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const extracted = await inspectPreviewState(tab);

    if (extracted?.svgOuterHTML) {
      return extracted;
    }

    if (extracted?.hasImagePreview) {
      break;
    }

    if (attempt < attempts - 1) {
      await tab.playwright.waitForTimeout(waitMs);
    }
  }

  const clipboardExtracted = await extractCurrentIconSvgFromClipboard(tab);
  if (clipboardExtracted?.svgOuterHTML) {
    return clipboardExtracted;
  }

  throw new Error("preview-svg-not-found-after-wait");
}

export async function runManifestExtraction({
  manifestPath,
  tab,
  attempts = 20,
  waitMs = 500,
  itemRetries = 2,
  maxItems,
  cleanupAfterItem,
} = {}) {
  if (!manifestPath || !tab) {
    throw new Error("runManifestExtraction requires manifestPath and tab");
  }

  const manifest = await loadManifest(manifestPath);
  const pendingItems = manifest.items.filter((item) => item.status !== "success");
  const selectedItems = Number.isInteger(maxItems) && maxItems > 0
    ? pendingItems.slice(0, maxItems)
    : pendingItems;
  const results = [];
  let aborted = false;
  let abortReason = null;

  for (const item of selectedItems) {
    if (aborted) {
      break;
    }
    try {
      let extracted = null;
      let lastError = null;
      for (let itemAttempt = 0; itemAttempt < itemRetries; itemAttempt += 1) {
        try {
          await tab.goto(item.iconUrl);
          await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 20_000 });
          await assertStreamlineDetailPage(tab, item.iconUrl);
          extracted = await extractCurrentIconSvgFromTab(tab, { attempts, waitMs });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (error instanceof StreamlineQuotaExceededError) {
            throw error;
          }
          if (
            error instanceof Error &&
            (error.message.startsWith("streamline-redirected-to-pricing:") ||
              error.message.startsWith("streamline-redirected-to-profile:") ||
              error.message.startsWith("streamline-unexpected-url:"))
          ) {
            break;
          }
        }
      }
      if (!extracted?.svgOuterHTML) {
        throw lastError ?? new Error("preview-svg-not-found-after-wait");
      }

      await writeSvgFile(resolve(item.outputPath), extracted.svgOuterHTML);
      await markManifestItemSuccess({
        manifestPath,
        itemId: item.itemId,
        slug: item.slug,
        extractedAt: new Date().toISOString(),
      });
      results.push({
        itemId: item.itemId ?? item.slug,
        slug: item.slug,
        ok: true,
        outputPath: item.outputPath,
        ariaLabel: extracted.ariaLabel,
      });
    } catch (error) {
      if (error instanceof StreamlineQuotaExceededError) {
        aborted = true;
        abortReason = error.message;
        results.push({
          itemId: item.itemId ?? item.slug,
          slug: item.slug,
          ok: false,
          aborted: true,
          error: error.message,
        });
        continue;
      }
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      await markManifestItemFailed({
        manifestPath,
        itemId: item.itemId,
        slug: item.slug,
        error: message,
      });
      results.push({
        itemId: item.itemId ?? item.slug,
        slug: item.slug,
        ok: false,
        error: message,
      });
    } finally {
      if (typeof cleanupAfterItem === "function") {
        await cleanupAfterItem(item).catch(() => {});
      }
    }
  }

  return {
    family: manifest.family,
    total: selectedItems.length,
    success: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    aborted,
    abortReason,
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
