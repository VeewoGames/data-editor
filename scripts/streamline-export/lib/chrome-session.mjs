import { runManifestExtraction as defaultRunManifestExtraction } from "../extract-streamline-svg-dom.mjs";

export function findPreferredStreamlineTab(openTabs) {
  const tabs = Array.isArray(openTabs) ? openTabs : [];
  return tabs.find((tab) => String(tab?.url ?? "").includes("streamlinehq.com/icons/download/")) ?? null;
}

export function findReusableStreamlineAgentTab(openTabs, sessionName = "🔎 Streamline") {
  const tabs = Array.isArray(openTabs) ? openTabs : [];
  return tabs.find((tab) => {
    const tabGroup = String(tab?.tabGroup ?? "");
    const url = String(tab?.url ?? "");
    return tabGroup === sessionName && url.includes("streamlinehq.com/icons/download/");
  }) ?? null;
}

function isResidualStreamlineAgentTab(tab) {
  const url = String(tab?.url ?? "");
  const tabGroup = String(tab?.tabGroup ?? "");
  const isAgentStreamlineGroup = tabGroup.startsWith("🔎 Streamline");
  const isResidualUrl =
    url.includes("home.streamlinehq.com/pricing") ||
    url.includes("www.streamlinehq.com/profile");
  return isAgentStreamlineGroup && isResidualUrl;
}

export async function cleanupResidualStreamlineAgentTabs(browser) {
  const openTabs = await browser.user.openTabs();
  const residualTabs = openTabs.filter(isResidualStreamlineAgentTab);
  const closed = [];

  for (const residualTab of residualTabs) {
    try {
      const claimedTab = await browser.user.claimTab(residualTab);
      await claimedTab.close().catch(() => {});
      closed.push({
        id: residualTab.id,
        url: residualTab.url ?? null,
        tabGroup: residualTab.tabGroup ?? null,
      });
    } catch {
      // Ignore cleanup races from tabs already closed by the user or another session.
    }
  }

  return closed;
}

export async function claimStreamlineTab(browser) {
  const openTabs = await browser.user.openTabs();
  const preferredTab = findPreferredStreamlineTab(openTabs);
  if (!preferredTab) {
    throw new Error("No Streamline download tab found");
  }
  return browser.user.claimTab(preferredTab);
}

export async function openStreamlineTab(browser, {
  url = null,
} = {}) {
  const tab = await browser.tabs.new();
  if (url) {
    await tab.goto(url);
  }
  return tab;
}

export async function acquireReusableStreamlineTab(browser, {
  sessionName = "🔎 Streamline SVG runner",
} = {}) {
  const openTabs = await browser.user.openTabs();
  const reusableTab = findReusableStreamlineAgentTab(openTabs, sessionName);
  if (reusableTab) {
    return browser.user.claimTab(reusableTab);
  }
  return openStreamlineTab(browser);
}

export async function runStreamlineSvgExtractionWithBrowser({
  browser,
  manifestPath,
  sessionName = "🔎 Streamline SVG runner",
  attempts = 20,
  waitMs = 500,
  maxItems,
  runManifestExtraction = defaultRunManifestExtraction,
  acquireTab = acquireReusableStreamlineTab,
} = {}) {
  if (!browser || !manifestPath) {
    throw new Error("runStreamlineSvgExtractionWithBrowser requires browser and manifestPath");
  }

  await browser.nameSession(sessionName);
  await cleanupResidualStreamlineAgentTabs(browser);
  const tab = await acquireTab(browser, { sessionName });

  try {
    return await runManifestExtraction({
      manifestPath,
      tab,
      attempts,
      waitMs,
      maxItems,
      cleanupAfterItem: async () => cleanupResidualStreamlineAgentTabs(browser),
    });
  } finally {
    await cleanupResidualStreamlineAgentTabs(browser).catch(() => []);
    await browser.tabs.finalize({ keep: [{ tab, status: "handoff" }] });
  }
}
