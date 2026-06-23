import { runManifestExtraction as defaultRunManifestExtraction } from "../extract-streamline-svg-dom.mjs";

export function findPreferredStreamlineTab(openTabs) {
  const tabs = Array.isArray(openTabs) ? openTabs : [];
  return (
    tabs.find((tab) => String(tab?.url ?? "").includes("streamlinehq.com/icons/download/")) ??
    tabs.find((tab) => String(tab?.url ?? "").includes("streamlinehq.com")) ??
    null
  );
}

export async function claimStreamlineTab(browser) {
  const openTabs = await browser.user.openTabs();
  const preferredTab = findPreferredStreamlineTab(openTabs);
  if (!preferredTab) {
    throw new Error("No Streamline tab found");
  }
  return browser.user.claimTab(preferredTab);
}

export async function openStreamlineTab(browser, {
  url = "https://www.streamlinehq.com/icons/micro-solid",
} = {}) {
  const tab = await browser.tabs.new();
  if (url) {
    await tab.goto(url);
  }
  return tab;
}

export async function runStreamlineSvgExtractionWithBrowser({
  browser,
  manifestPath,
  sessionName = "🔎 Streamline SVG runner",
  attempts = 20,
  waitMs = 500,
  maxItems,
  runManifestExtraction = defaultRunManifestExtraction,
  acquireTab = claimStreamlineTab,
} = {}) {
  if (!browser || !manifestPath) {
    throw new Error("runStreamlineSvgExtractionWithBrowser requires browser and manifestPath");
  }

  await browser.nameSession(sessionName);
  const tab = await acquireTab(browser);

  try {
    return await runManifestExtraction({
      manifestPath,
      tab,
      attempts,
      waitMs,
      maxItems,
    });
  } finally {
    await tab.close().catch(() => {});
    await browser.tabs.finalize({ keep: [] });
  }
}
