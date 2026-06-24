import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, loadManifestSummary } from "./lib/manifest-store.mjs";
import { importManifestSvgFromMcp } from "./import-streamline-svg-from-mcp.mjs";
import { verifyStreamlineSvgManifest } from "./verify-streamline-svg.mjs";

export async function buildStreamlineMcpSvgPreflight({
  manifestPath,
  apiKeyPresent = false,
  pendingHeadLimit = 20,
  loadManifestImpl = loadManifest,
  loadManifestSummaryImpl = loadManifestSummary,
  verifyManifest = verifyStreamlineSvgManifest,
} = {}) {
  if (!manifestPath) {
    throw new Error("buildStreamlineMcpSvgPreflight requires manifestPath");
  }
  if (!Number.isInteger(pendingHeadLimit) || pendingHeadLimit <= 0) {
    throw new Error("buildStreamlineMcpSvgPreflight requires a positive pendingHeadLimit");
  }

  const [manifest, summary, verification] = await Promise.all([
    loadManifestImpl(manifestPath),
    loadManifestSummaryImpl(manifestPath),
    verifyManifest({ manifestPath }),
  ]);
  const items = Array.isArray(manifest?.items) ? manifest.items : [];
  const hashMissingItems = items.filter((item) => !item?.hash);
  const pendingHead = items
    .filter((item) => item?.status === "pending")
    .slice(0, pendingHeadLimit)
    .map((item) => item.slug);
  const blockers = [];
  if (!apiKeyPresent) {
    blockers.push("STREAMLINE_API_KEY missing");
  }
  if (hashMissingItems.length > 0) {
    blockers.push(`Missing official hash for ${hashMissingItems.length} items`);
  }
  if (verification.successMissingFiles.length > 0) {
    blockers.push(`Manifest success items missing files: ${verification.successMissingFiles.length}`);
  }
  if (verification.successInvalidSvg.length > 0) {
    blockers.push(`Manifest success items with invalid svg: ${verification.successInvalidSvg.length}`);
  }
  if (verification.successEmptyFiles.length > 0) {
    blockers.push(`Manifest success items with empty svg: ${verification.successEmptyFiles.length}`);
  }

  return {
    family: manifest.family,
    manifestPath,
    apiKeyPresent,
    total: summary.total,
    success: summary.success,
    pending: summary.pending,
    failed: summary.failed,
    withHash: items.length - hashMissingItems.length,
    missingHashCount: hashMissingItems.length,
    missingHashHead: hashMissingItems.slice(0, pendingHeadLimit).map((item) => item.slug),
    pendingHead,
    verification,
    blockers,
    canRunImport: blockers.length === 0,
  };
}

export async function runStreamlineMcpSvgImportLoop({
  manifestPath,
  apiKey,
  batchSize = 25,
  maxBatches = Number.POSITIVE_INFINITY,
  concurrency = 1,
  force = false,
  retryFailed = false,
  stopOnFailure = true,
  verifyAfterBatch = true,
  importSvg = importManifestSvgFromMcp,
  verifyManifest = verifyStreamlineSvgManifest,
} = {}) {
  if (!manifestPath) {
    throw new Error("runStreamlineMcpSvgImportLoop requires manifestPath");
  }
  if (!apiKey) {
    throw new Error("runStreamlineMcpSvgImportLoop requires apiKey");
  }
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("runStreamlineMcpSvgImportLoop requires a positive batchSize");
  }
  if (!(maxBatches > 0)) {
    throw new Error("runStreamlineMcpSvgImportLoop requires maxBatches > 0");
  }
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error("runStreamlineMcpSvgImportLoop requires concurrency >= 1");
  }

  const batches = [];

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    const before = await loadManifestSummary(manifestPath);
    if (before.pending <= 0 && !(force || retryFailed)) {
      return {
        complete: true,
        batches,
        before,
        after: before,
        verification: verifyAfterBatch ? await verifyManifest({ manifestPath }) : null,
      };
    }

    const requested = force || retryFailed
      ? batchSize
      : Math.min(batchSize, before.pending);

    const result = await importSvg({
      manifestPath,
      apiKey,
      maxItems: requested,
      force,
      retryFailed,
      concurrency,
    });
    const after = await loadManifestSummary(manifestPath);
    const verification = verifyAfterBatch ? await verifyManifest({ manifestPath }) : null;
    const batch = {
      index: batchIndex + 1,
      requested,
      success: result.success,
      failed: result.failed,
      pendingBefore: before.pending,
      pendingAfter: after.pending,
      verification,
    };
    batches.push(batch);

    if (stopOnFailure && result.failed > 0) {
      return {
        complete: false,
        batches,
        before,
        after,
        verification,
      };
    }
  }

  const after = await loadManifestSummary(manifestPath);
  const verification = verifyAfterBatch ? await verifyManifest({ manifestPath }) : null;
  return {
    complete: after.pending <= 0,
    batches,
    before: batches[0] ? undefined : after,
    after,
    verification,
  };
}

function parseCliArgs(argv) {
  const options = {
    manifestPath: "",
    batchSize: 25,
    maxBatches: Number.POSITIVE_INFINITY,
    concurrency: 1,
    force: false,
    retryFailed: false,
    stopOnFailure: true,
    verifyAfterBatch: true,
    preflightOnly: false,
    pendingHeadLimit: 20,
  };
  const positional = [];

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--batch-size") {
      const nextValue = argv[index + 1];
      if (!nextValue) throw new Error("--batch-size requires a value");
      options.batchSize = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }
    if (value === "--max-batches") {
      const nextValue = argv[index + 1];
      if (!nextValue) throw new Error("--max-batches requires a value");
      options.maxBatches = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }
    if (value === "--concurrency") {
      const nextValue = argv[index + 1];
      if (!nextValue) throw new Error("--concurrency requires a value");
      options.concurrency = Number.parseInt(nextValue, 10);
      index += 1;
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
    if (value === "--continue-on-failure") {
      options.stopOnFailure = false;
      continue;
    }
    if (value === "--skip-verify") {
      options.verifyAfterBatch = false;
      continue;
    }
    if (value === "--preflight-only") {
      options.preflightOnly = true;
      continue;
    }
    if (value === "--pending-head") {
      const nextValue = argv[index + 1];
      if (!nextValue) throw new Error("--pending-head requires a value");
      options.pendingHeadLimit = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }
    positional.push(value);
  }

  options.manifestPath = positional[0] ? resolve(positional[0]) : "";
  return options;
}

async function main(argv) {
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const parsed = parseCliArgs(argv);
  const manifestPath = parsed.manifestPath ? resolve(projectRoot, parsed.manifestPath) : "";
  const apiKey = process.env.STREAMLINE_API_KEY ?? "";

  if (!manifestPath) {
    throw new Error("Usage: STREAMLINE_API_KEY=<key> node scripts/streamline-export/run-streamline-mcp-svg-session.mjs <manifestPath> [--batch-size <n>] [--max-batches <n>] [--concurrency <n>] [--force] [--retry-failed] [--continue-on-failure] [--skip-verify] [--preflight-only] [--pending-head <n>]");
  }

  const preflight = await buildStreamlineMcpSvgPreflight({
    manifestPath,
    apiKeyPresent: Boolean(apiKey),
    pendingHeadLimit: parsed.pendingHeadLimit,
  });

  if (parsed.preflightOnly) {
    console.log(JSON.stringify(preflight, null, 2));
    return;
  }
  if (!apiKey) {
    throw new Error("STREAMLINE_API_KEY is required");
  }

  const result = await runStreamlineMcpSvgImportLoop({
    manifestPath,
    apiKey,
    batchSize: parsed.batchSize,
    maxBatches: parsed.maxBatches,
    concurrency: parsed.concurrency,
    force: parsed.force,
    retryFailed: parsed.retryFailed,
    stopOnFailure: parsed.stopOnFailure,
    verifyAfterBatch: parsed.verifyAfterBatch,
  });

  console.log(JSON.stringify({ preflight, manifestPath, ...result }, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("run-streamline-mcp-svg-session.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
