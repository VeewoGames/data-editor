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

export async function runStreamlineSvgExtractionWithBrowser({
  browser,
  manifestPath,
  sessionName = "🔎 Streamline SVG runner",
  attempts = 20,
  waitMs = 500,
  runManifestExtraction = defaultRunManifestExtraction,
} = {}) {
  if (!browser || !manifestPath) {
    throw new Error("runStreamlineSvgExtractionWithBrowser requires browser and manifestPath");
  }

  await browser.nameSession(sessionName);
  const tab = await claimStreamlineTab(browser);

  try {
    return await runManifestExtraction({
      manifestPath,
      tab,
      attempts,
      waitMs,
    });
  } finally {
    await browser.tabs.finalize({ keep: [] });
  }
}
