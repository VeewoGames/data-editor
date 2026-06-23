import { runStreamlineSvgExtractionWithBrowser } from "./lib/chrome-session.mjs";
import { loadManifestSummary } from "./lib/manifest-store.mjs";

export async function connectChromeBrowser({
  setupBrowserRuntime,
  globals = globalThis,
  agentLike,
} = {}) {
  if (typeof setupBrowserRuntime !== "function") {
    throw new Error("connectChromeBrowser requires setupBrowserRuntime");
  }

  await setupBrowserRuntime({ globals });
  const resolvedAgent = agentLike ?? globals.agent;
  if (!resolvedAgent?.browsers?.get) {
    throw new Error("connectChromeBrowser requires agent.browsers.get");
  }
  return resolvedAgent.browsers.get("extension");
}

export async function runStreamlineSvgExtractionFromNodeRepl({
  manifestPath,
  sessionName = "🔎 Streamline SVG runner",
  attempts = 20,
  waitMs = 500,
  maxItems,
  connectBrowser,
  runWithBrowser = runStreamlineSvgExtractionWithBrowser,
  acquireTab,
} = {}) {
  if (!manifestPath) {
    throw new Error("runStreamlineSvgExtractionFromNodeRepl requires manifestPath");
  }
  if (typeof connectBrowser !== "function") {
    throw new Error("runStreamlineSvgExtractionFromNodeRepl requires connectBrowser");
  }

  const browser = await connectBrowser();
  return runWithBrowser({
    browser,
    manifestPath,
    sessionName,
    attempts,
    waitMs,
    maxItems,
    acquireTab,
  });
}

export async function runStreamlineSvgExtractionLoopFromNodeRepl({
  manifestPath,
  sessionName = "🔎 Streamline SVG runner",
  attempts = 20,
  waitMs = 500,
  batchSize = 25,
  maxBatches = Number.POSITIVE_INFINITY,
  stopOnFailure = true,
  connectBrowser,
  runWithBrowser = runStreamlineSvgExtractionWithBrowser,
  acquireTab,
} = {}) {
  if (!manifestPath) {
    throw new Error("runStreamlineSvgExtractionLoopFromNodeRepl requires manifestPath");
  }
  if (typeof connectBrowser !== "function") {
    throw new Error("runStreamlineSvgExtractionLoopFromNodeRepl requires connectBrowser");
  }
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("runStreamlineSvgExtractionLoopFromNodeRepl requires a positive batchSize");
  }
  if (!(maxBatches > 0)) {
    throw new Error("runStreamlineSvgExtractionLoopFromNodeRepl requires maxBatches > 0");
  }

  const browser = await connectBrowser();
  const batches = [];

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    const before = await loadManifestSummary(manifestPath);
    if (before.pending <= 0) {
      return {
        complete: true,
        batches,
        before,
        after: before,
      };
    }

    const result = await runWithBrowser({
      browser,
      manifestPath,
      sessionName: `${sessionName} #${batchIndex + 1}`,
      attempts,
      waitMs,
      maxItems: Math.min(batchSize, before.pending),
      acquireTab,
    });
    const after = await loadManifestSummary(manifestPath);
    const batch = {
      index: batchIndex + 1,
      requested: Math.min(batchSize, before.pending),
      success: result.success,
      failed: result.failed,
      pendingBefore: before.pending,
      pendingAfter: after.pending,
    };
    batches.push(batch);
    if (stopOnFailure && result.failed > 0) {
      return {
        complete: false,
        batches,
        before,
        after,
      };
    }
  }

  const after = await loadManifestSummary(manifestPath);
  return {
    complete: after.pending <= 0,
    batches,
    before: batches[0] ? undefined : after,
    after,
  };
}
