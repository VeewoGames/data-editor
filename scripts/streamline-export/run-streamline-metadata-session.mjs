import {
  DEFAULT_STREAMLINE_HUMAN_METADATA_PACING,
  runStreamlineMetadataExtractionWithBrowser,
} from "./lib/streamline-metadata-session.mjs";
import { loadManifest, loadManifestMetadataSummary } from "./lib/manifest-store.mjs";
import { runStreamlineMetadataLoop } from "./lib/streamline-metadata-loop.mjs";
import { syncManifestMetadataFromMcp } from "./sync-streamline-metadata-from-mcp.mjs";
import { generateSharedViewStreamlineIcons } from "./generate-shared-view-streamline-icons.mjs";
import { getStreamlineFamilyEntryConfig } from "./lib/streamline-family-entry-config.mjs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { access } from "node:fs/promises";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveSharedViewRegistryManifestPaths(manifestPath) {
  const manifest = await loadManifest(manifestPath);
  const family = String(manifest?.family ?? "").trim();
  if (!family) {
    return [manifestPath];
  }

  let canonicalManifestPath = manifestPath;
  try {
    canonicalManifestPath = resolve(projectRoot, getStreamlineFamilyEntryConfig(family).manifestPath);
  } catch {
    return [manifestPath];
  }

  if (resolve(manifestPath) !== canonicalManifestPath) {
    return [manifestPath];
  }

  const sharedFamilies = family === "micro-line" || family === "micro-solid"
    ? ["micro-solid", "micro-line"]
    : [family];

  const manifestPaths = [];
  for (const entryFamily of sharedFamilies) {
    const entry = getStreamlineFamilyEntryConfig(entryFamily);
    const entryManifestPath = resolve(projectRoot, entry.manifestPath);
    if (await pathExists(entryManifestPath)) {
      manifestPaths.push(entryManifestPath);
    }
  }
  return manifestPaths.length > 0 ? manifestPaths : [manifestPath];
}

export async function syncSharedViewRegistryForManifestPath(manifestPath) {
  const manifestPaths = await resolveSharedViewRegistryManifestPaths(manifestPath);
  return generateSharedViewStreamlineIcons({
    manifestPaths,
    runtimeOutputPath: resolve(projectRoot, "src/generated/streamline-shared-view-icons.mjs"),
    typesOutputPath: resolve(projectRoot, "src/generated/streamline-shared-view-icons.d.ts"),
  });
}

function applyHumanModeDefaults({
  waitMs,
  postLoadJitterMs,
  preNavigationDelayMs,
  preNavigationJitterMs,
  postItemDelayMs,
  postItemJitterMs,
  concurrency,
  humanMode = false,
} = {}) {
  if (!humanMode) {
    return {
      waitMs,
      postLoadJitterMs,
      preNavigationDelayMs,
      preNavigationJitterMs,
      postItemDelayMs,
      postItemJitterMs,
      concurrency,
    };
  }

  return {
    waitMs: waitMs ?? DEFAULT_STREAMLINE_HUMAN_METADATA_PACING.waitMs,
    postLoadJitterMs: postLoadJitterMs ?? DEFAULT_STREAMLINE_HUMAN_METADATA_PACING.postLoadJitterMs,
    preNavigationDelayMs: preNavigationDelayMs ?? DEFAULT_STREAMLINE_HUMAN_METADATA_PACING.preNavigationDelayMs,
    preNavigationJitterMs: preNavigationJitterMs ?? DEFAULT_STREAMLINE_HUMAN_METADATA_PACING.preNavigationJitterMs,
    postItemDelayMs: postItemDelayMs ?? DEFAULT_STREAMLINE_HUMAN_METADATA_PACING.postItemDelayMs,
    postItemJitterMs: postItemJitterMs ?? DEFAULT_STREAMLINE_HUMAN_METADATA_PACING.postItemJitterMs,
    concurrency: 1,
  };
}

export async function runStreamlineMetadataExtractionFromNodeRepl({
  manifestPath,
  sessionName = "🔎 Streamline metadata runner",
  waitMs,
  postLoadJitterMs,
  preNavigationDelayMs,
  preNavigationJitterMs,
  postItemDelayMs,
  postItemJitterMs,
  maxItems,
  force = false,
  retryFailed = false,
  itemIds,
  concurrency = 1,
  humanMode = false,
  connectBrowser,
  runWithBrowser = runStreamlineMetadataExtractionWithBrowser,
  acquireTab,
  syncRegistry = syncSharedViewRegistryForManifestPath,
} = {}) {
  if (!manifestPath) {
    throw new Error("runStreamlineMetadataExtractionFromNodeRepl requires manifestPath");
  }
  if (typeof connectBrowser !== "function") {
    throw new Error("runStreamlineMetadataExtractionFromNodeRepl requires connectBrowser");
  }

  const browser = await connectBrowser();
  const pacedOptions = applyHumanModeDefaults({
    waitMs,
    postLoadJitterMs,
    preNavigationDelayMs,
    preNavigationJitterMs,
    postItemDelayMs,
    postItemJitterMs,
    concurrency,
    humanMode,
  });
  const result = await runWithBrowser({
    browser,
    manifestPath,
    sessionName,
    waitMs: pacedOptions.waitMs,
    postLoadJitterMs: pacedOptions.postLoadJitterMs,
    preNavigationDelayMs: pacedOptions.preNavigationDelayMs,
    preNavigationJitterMs: pacedOptions.preNavigationJitterMs,
    postItemDelayMs: pacedOptions.postItemDelayMs,
    postItemJitterMs: pacedOptions.postItemJitterMs,
    maxItems,
    force,
    retryFailed,
    itemIds,
    concurrency: pacedOptions.concurrency,
    humanMode,
    acquireTab,
  });
  if (typeof syncRegistry === "function") {
    await syncRegistry(manifestPath);
  }
  return result;
}

export async function runStreamlineMetadataExtractionLoopFromNodeRepl({
  manifestPath,
  sessionName = "🔎 Streamline metadata runner",
  waitMs,
  postLoadJitterMs,
  preNavigationDelayMs,
  preNavigationJitterMs,
  postItemDelayMs,
  postItemJitterMs,
  batchSize = 24,
  maxBatches = Number.POSITIVE_INFINITY,
  stopOnFailure = false,
  reuseBrowser = false,
  force = false,
  retryFailed = false,
  itemIds,
  concurrency = 1,
  humanMode = false,
  connectBrowser,
  runWithBrowser = runStreamlineMetadataExtractionWithBrowser,
  acquireTab,
  syncRegistry = syncSharedViewRegistryForManifestPath,
} = {}) {
  if (typeof connectBrowser !== "function") {
    throw new Error("runStreamlineMetadataExtractionLoopFromNodeRepl requires connectBrowser");
  }

  let browser = null;
  const pacedOptions = applyHumanModeDefaults({
    waitMs,
    postLoadJitterMs,
    preNavigationDelayMs,
    preNavigationJitterMs,
    postItemDelayMs,
    postItemJitterMs,
    concurrency,
    humanMode,
  });

  const result = await runStreamlineMetadataLoop({
    manifestPath,
    batchSize,
    maxBatches,
    stopOnFailure,
    loadSummary: loadManifestMetadataSummary,
    runBatch: async ({ batchIndex, requested }) => {
      if (!browser || !reuseBrowser) {
        browser = await connectBrowser();
      }
      return runWithBrowser({
        browser,
        manifestPath,
        sessionName: `${sessionName} #${batchIndex + 1}`,
        waitMs: pacedOptions.waitMs,
        postLoadJitterMs: pacedOptions.postLoadJitterMs,
        preNavigationDelayMs: pacedOptions.preNavigationDelayMs,
        preNavigationJitterMs: pacedOptions.preNavigationJitterMs,
        postItemDelayMs: pacedOptions.postItemDelayMs,
        postItemJitterMs: pacedOptions.postItemJitterMs,
        maxItems: requested,
        force,
        retryFailed,
        itemIds,
        concurrency: pacedOptions.concurrency,
        humanMode,
        acquireTab,
      });
    },
  });
  if (typeof syncRegistry === "function") {
    await syncRegistry(manifestPath);
  }
  return result;
}

export async function runStreamlineMetadataSyncLoopFromMcp({
  manifestPath,
  apiKey,
  batchSize = 24,
  maxBatches = Number.POSITIVE_INFINITY,
  stopOnFailure = false,
  force = false,
  retryFailed = false,
  itemIds,
  concurrency = 1,
  syncWithMcp = syncManifestMetadataFromMcp,
  syncRegistry = syncSharedViewRegistryForManifestPath,
} = {}) {
  if (!apiKey) {
    throw new Error("runStreamlineMetadataSyncLoopFromMcp requires apiKey");
  }

  const result = await runStreamlineMetadataLoop({
    manifestPath,
    batchSize,
    maxBatches,
    stopOnFailure,
    loadSummary: loadManifestMetadataSummary,
    runBatch: async ({ requested }) => syncWithMcp({
      manifestPath,
      apiKey,
      maxItems: requested,
      force,
      retryFailed,
      itemIds,
      concurrency,
    }),
  });
  if (typeof syncRegistry === "function") {
    await syncRegistry(manifestPath);
  }
  return result;
}

export async function runStreamlineMetadataHybridLoop({
  manifestPath,
  apiKey,
  connectBrowser,
  batchSize = 24,
  maxBatches = Number.POSITIVE_INFINITY,
  stopOnFailure = false,
  force = false,
  retryFailed = false,
  itemIds,
  mcpConcurrency = 4,
  browserFallbackEnabled = true,
  browserFallbackErrorPattern = /Official MCP metadata returned no tags/i,
  browserFallbackOptions = {},
  syncWithMcp = syncManifestMetadataFromMcp,
  runBrowserBatch = runStreamlineMetadataExtractionFromNodeRepl,
  syncRegistry = syncSharedViewRegistryForManifestPath,
} = {}) {
  if (!apiKey) {
    throw new Error("runStreamlineMetadataHybridLoop requires apiKey");
  }
  if (browserFallbackEnabled && typeof connectBrowser !== "function") {
    throw new Error("runStreamlineMetadataHybridLoop requires connectBrowser when browser fallback is enabled");
  }

  const result = await runStreamlineMetadataLoop({
    manifestPath,
    batchSize,
    maxBatches,
    stopOnFailure,
    loadSummary: loadManifestMetadataSummary,
    runBatch: async ({ requested }) => {
      const mcpResult = await syncWithMcp({
        manifestPath,
        apiKey,
        maxItems: requested,
        force,
        retryFailed,
        itemIds,
        concurrency: mcpConcurrency,
      });

      if (!browserFallbackEnabled) {
        return mcpResult;
      }

      const fallbackItemIds = (Array.isArray(mcpResult.results) ? mcpResult.results : [])
        .filter((result) => !result?.ok && browserFallbackErrorPattern.test(String(result?.error ?? "")))
        .map((result) => result.itemId ?? result.slug)
        .filter(Boolean);

      if (fallbackItemIds.length === 0) {
        return mcpResult;
      }

      const browserResult = await runBrowserBatch({
        manifestPath,
        connectBrowser,
        maxItems: fallbackItemIds.length,
        retryFailed: true,
        itemIds: fallbackItemIds,
        ...browserFallbackOptions,
      });

      const nonFallbackFailures = (Array.isArray(mcpResult.results) ? mcpResult.results : [])
        .filter((result) => !result?.ok && !fallbackItemIds.includes(result.itemId ?? result.slug))
        .length;

      return {
        success: Number(mcpResult.success ?? 0) + Number(browserResult.success ?? 0),
        failed: nonFallbackFailures + Number(browserResult.failed ?? 0),
      };
    },
  });
  if (typeof syncRegistry === "function") {
    await syncRegistry(manifestPath);
  }
  return result;
}

function parseCliArgs(argv) {
  const options = {
    manifestPath: "",
    transport: "mcp",
    batchSize: 24,
    maxBatches: Number.POSITIVE_INFINITY,
    stopOnFailure: false,
    force: false,
    retryFailed: false,
    concurrency: 1,
  };
  const positional = [];

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--transport") {
      options.transport = String(argv[++index] ?? "").trim();
      continue;
    }
    if (value === "--batch-size") {
      options.batchSize = Number.parseInt(argv[++index], 10);
      continue;
    }
    if (value === "--max-batches") {
      const raw = argv[++index];
      options.maxBatches = raw === "Infinity" ? Number.POSITIVE_INFINITY : Number.parseInt(raw, 10);
      continue;
    }
    if (value === "--concurrency") {
      options.concurrency = Number.parseInt(argv[++index], 10);
      continue;
    }
    if (value === "--stop-on-failure") {
      options.stopOnFailure = true;
      continue;
    }
    if (value === "--force") {
      options.force = true;
      continue;
    }
    if (value === "--retry-failed") {
      options.retryFailed = true;
      continue;
    }
    positional.push(value);
  }

  options.manifestPath = positional[0] ? resolve(positional[0]) : "";
  return options;
}

async function main(argv) {
  const parsed = parseCliArgs(argv);
  const manifestPath = parsed.manifestPath ? resolve(projectRoot, parsed.manifestPath) : "";
  if (!manifestPath) {
    throw new Error("Usage: STREAMLINE_API_KEY=<key> node scripts/streamline-export/run-streamline-metadata-session.mjs <manifestPath> [--transport mcp] [--batch-size <n>] [--max-batches <n>] [--concurrency <n>] [--stop-on-failure] [--force] [--retry-failed]");
  }
  if (parsed.transport !== "mcp") {
    throw new Error("CLI mode currently supports only --transport mcp; browser transport remains a library/node_repl surface");
  }

  const result = await runStreamlineMetadataSyncLoopFromMcp({
    manifestPath,
    apiKey: process.env.STREAMLINE_API_KEY ?? "",
    batchSize: parsed.batchSize,
    maxBatches: parsed.maxBatches,
    stopOnFailure: parsed.stopOnFailure,
    force: parsed.force,
    retryFailed: parsed.retryFailed,
    concurrency: parsed.concurrency,
  });
  console.log(JSON.stringify({
    manifestPath,
    transport: parsed.transport,
    ...result,
  }, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("run-streamline-metadata-session.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
