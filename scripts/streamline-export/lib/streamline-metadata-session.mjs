import { acquireReusableStreamlineTab, cleanupResidualStreamlineAgentTabs } from "./chrome-session.mjs";
import {
  runManifestMetadataExtraction as defaultRunManifestMetadataExtraction,
  runManifestMetadataExtractionParallel as defaultRunManifestMetadataExtractionParallel,
} from "../extract-streamline-detail-metadata.mjs";

export const DEFAULT_STREAMLINE_HUMAN_METADATA_PACING = Object.freeze({
  waitMs: 1_200,
  postLoadJitterMs: 800,
  preNavigationDelayMs: 900,
  preNavigationJitterMs: 1_400,
  postItemDelayMs: 1_500,
  postItemJitterMs: 2_500,
});

export async function runStreamlineMetadataExtractionWithBrowser({
  browser,
  manifestPath,
  sessionName = "🔎 Streamline metadata runner",
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
  concurrency = 1,
  humanMode = false,
  runManifestMetadataExtraction = defaultRunManifestMetadataExtraction,
  runManifestMetadataExtractionParallel = defaultRunManifestMetadataExtractionParallel,
  acquireTab = acquireReusableStreamlineTab,
} = {}) {
  if (!browser || !manifestPath) {
    throw new Error("runStreamlineMetadataExtractionWithBrowser requires browser and manifestPath");
  }
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error("runStreamlineMetadataExtractionWithBrowser requires concurrency >= 1");
  }
  if (humanMode && concurrency !== 1) {
    throw new Error("runStreamlineMetadataExtractionWithBrowser humanMode requires concurrency = 1");
  }

  await browser.nameSession(sessionName);
  await cleanupResidualStreamlineAgentTabs(browser);
  const primaryTab = await acquireTab(browser, { sessionName });
  const tabs = [primaryTab];

  for (let index = 1; index < concurrency; index += 1) {
    tabs.push(await browser.tabs.new());
  }

  try {
    if (concurrency === 1) {
      return await runManifestMetadataExtraction({
        manifestPath,
        tab: primaryTab,
        waitMs,
        postLoadJitterMs,
        preNavigationDelayMs,
        preNavigationJitterMs,
        postItemDelayMs,
        postItemJitterMs,
        maxItems,
        force,
        retryFailed,
        itemIds,
        cleanupAfterItem: async () => cleanupResidualStreamlineAgentTabs(browser),
      });
    }

    return await runManifestMetadataExtractionParallel({
      manifestPath,
      tabs,
      waitMs,
      postLoadJitterMs,
      preNavigationDelayMs,
      preNavigationJitterMs,
      postItemDelayMs,
      postItemJitterMs,
      maxItems,
      force,
      retryFailed,
      itemIds,
      cleanupAfterItem: async () => cleanupResidualStreamlineAgentTabs(browser),
    });
  } finally {
    await cleanupResidualStreamlineAgentTabs(browser).catch(() => []);
    await browser.tabs.finalize({ keep: [{ tab: primaryTab, status: "handoff" }] });
  }
}
