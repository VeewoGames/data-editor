import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./lib/manifest-store.mjs";
import { selectManifestMetadataCandidateItems } from "./lib/streamline-metadata-manifest.mjs";

const defaultUserAgent = [
  "Mozilla/5.0",
  "(Windows NT 10.0; Win64; x64)",
  "AppleWebKit/537.36",
  "(KHTML, like Gecko)",
  "Chrome/126.0.0.0",
  "Safari/537.36",
].join(" ");

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchDetailSource({
  item,
  userAgent = defaultUserAgent,
  requestDelayMs = 0,
  retryCount = 0,
  retryBaseDelayMs = 1000,
  fetchImpl = fetch,
} = {}) {
  let attempt = 0;
  while (true) {
    if (requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }
    const response = await fetchImpl(item.iconUrl, {
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (response.ok) {
      return {
        slug: item.slug,
        iconUrl: item.iconUrl,
        itemId: item.itemId ?? item.slug,
        hash: item.hash ?? null,
        source: await response.text(),
      };
    }

    const shouldRetry = response.status === 429 && attempt < retryCount;
    if (!shouldRetry) {
      throw new Error(`Failed to fetch detail source: ${response.status} ${response.statusText}`);
    }
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : retryBaseDelayMs * (attempt + 1);
    await sleep(delayMs);
    attempt += 1;
  }
}

export async function captureStreamlineDetailSources({
  manifestPath,
  outputPath,
  maxItems,
  force = false,
  retryFailed = false,
  concurrency = 1,
  requestDelayMs = 0,
  retryCount = 0,
  retryBaseDelayMs = 1000,
  fetchImpl = fetch,
  userAgent = defaultUserAgent,
} = {}) {
  if (!manifestPath || !outputPath) {
    throw new Error("captureStreamlineDetailSources requires manifestPath and outputPath");
  }
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error("captureStreamlineDetailSources requires concurrency >= 1");
  }

  const manifest = await loadManifest(manifestPath);
  const selectedItems = selectManifestMetadataCandidateItems(manifest.items, {
    force,
    retryFailed,
    maxItems,
  });

  const captured = [];
  const failed = [];

  for (let offset = 0; offset < selectedItems.length; offset += concurrency) {
    const chunk = selectedItems.slice(offset, offset + concurrency);
    const chunkResults = await Promise.all(chunk.map(async (item) => {
      try {
        const record = await fetchDetailSource({
          item,
          userAgent,
          requestDelayMs,
          retryCount,
          retryBaseDelayMs,
          fetchImpl,
        });
        captured.push(record);
      } catch (error) {
        failed.push({
          slug: item.slug,
          iconUrl: item.iconUrl,
          itemId: item.itemId ?? item.slug,
          hash: item.hash ?? null,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      }
    }));
    void chunkResults;
  }

  const payload = {
    manifestPath,
    family: manifest.family,
    generatedAt: new Date().toISOString(),
    items: captured,
    failed,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    family: manifest.family,
    total: selectedItems.length,
    captured: captured.length,
    failed: failed.length,
    outputPath,
  };
}

function parseCliArgs(argv) {
  const options = {
    manifestPath: "",
    outputPath: "",
    maxItems: undefined,
    force: false,
    retryFailed: false,
    concurrency: 1,
    requestDelayMs: 0,
    retryCount: 0,
    retryBaseDelayMs: 1000,
  };
  const positional = [];
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--force") {
      options.force = true;
      continue;
    }
    if (value === "--retry-failed") {
      options.retryFailed = true;
      continue;
    }
    if (value === "--max-items") {
      const nextValue = argv[index + 1];
      if (!nextValue) throw new Error("--max-items requires a value");
      options.maxItems = Number.parseInt(nextValue, 10);
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
    if (value === "--request-delay-ms") {
      const nextValue = argv[index + 1];
      if (!nextValue) throw new Error("--request-delay-ms requires a value");
      options.requestDelayMs = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }
    if (value === "--retry-count") {
      const nextValue = argv[index + 1];
      if (!nextValue) throw new Error("--retry-count requires a value");
      options.retryCount = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }
    if (value === "--retry-base-delay-ms") {
      const nextValue = argv[index + 1];
      if (!nextValue) throw new Error("--retry-base-delay-ms requires a value");
      options.retryBaseDelayMs = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }
    positional.push(value);
  }
  options.manifestPath = positional[0] ? resolve(positional[0]) : "";
  options.outputPath = positional[1] ? resolve(positional[1]) : "";
  return options;
}

async function main(argv) {
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const parsed = parseCliArgs(argv);
  const manifestPath = parsed.manifestPath ? resolve(projectRoot, parsed.manifestPath) : "";
  const outputPath = parsed.outputPath ? resolve(projectRoot, parsed.outputPath) : "";
  if (!manifestPath || !outputPath) {
    throw new Error("Usage: node scripts/streamline-export/capture-streamline-detail-sources.mjs <manifestPath> <outputPath> [--max-items <n>] [--concurrency <n>] [--request-delay-ms <n>] [--retry-count <n>] [--retry-base-delay-ms <n>] [--force] [--retry-failed]");
  }

  const result = await captureStreamlineDetailSources({
    manifestPath,
    outputPath,
    maxItems: parsed.maxItems,
    force: parsed.force,
    retryFailed: parsed.retryFailed,
    concurrency: parsed.concurrency,
    requestDelayMs: parsed.requestDelayMs,
    retryCount: parsed.retryCount,
    retryBaseDelayMs: parsed.retryBaseDelayMs,
  });

  console.log(JSON.stringify({
    manifestPath,
    outputPath,
    ...result,
  }, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("capture-streamline-detail-sources.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
