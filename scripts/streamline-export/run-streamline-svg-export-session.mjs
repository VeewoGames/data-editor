import { runStreamlineSvgExtractionWithBrowser } from "./lib/chrome-session.mjs";

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
  connectBrowser,
  runWithBrowser = runStreamlineSvgExtractionWithBrowser,
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
  });
}
