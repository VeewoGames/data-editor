import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hydrateManifestHashesFromFamily } from "./hydrate-streamline-manifest-hashes.mjs";
import { captureStreamlineDetailSources } from "./capture-streamline-detail-sources.mjs";
import { importStreamlineDetailSourceMetadata } from "./import-streamline-detail-source-metadata.mjs";
import { generateSharedViewStreamlineIcons } from "./generate-shared-view-streamline-icons.mjs";

const defaultArtifactsDir = "artifacts/streamline-export";
const microSolidFamilyHash = "fgr_zyeZBhASBrLyYT56";
const microSolidSetHash = "fam_N4qLKacuxV5kMUq4";

function parseCliArgs(argv) {
  const options = {
    manifestPath: "",
    familyHash: microSolidSetHash,
    captureOutputPath: "",
    runtimeOutputPath: "src/generated/streamline-shared-view-icons.mjs",
    typesOutputPath: "src/generated/streamline-shared-view-icons.d.ts",
    maxItems: undefined,
    concurrency: 1,
    requestDelayMs: 0,
    retryCount: 0,
    retryBaseDelayMs: 1000,
    skipHydrateHashes: false,
    skipCapture: false,
    skipImport: false,
    skipGenerateRegistry: false,
  };

  const positional = [];
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--max-items") {
      options.maxItems = Number.parseInt(argv[++index], 10);
      continue;
    }
    if (value === "--concurrency") {
      options.concurrency = Number.parseInt(argv[++index], 10);
      continue;
    }
    if (value === "--request-delay-ms") {
      options.requestDelayMs = Number.parseInt(argv[++index], 10);
      continue;
    }
    if (value === "--retry-count") {
      options.retryCount = Number.parseInt(argv[++index], 10);
      continue;
    }
    if (value === "--retry-base-delay-ms") {
      options.retryBaseDelayMs = Number.parseInt(argv[++index], 10);
      continue;
    }
    if (value === "--capture-output") {
      options.captureOutputPath = argv[++index];
      continue;
    }
    if (value === "--family-hash") {
      options.familyHash = argv[++index];
      continue;
    }
    if (value === "--skip-hydrate-hashes") {
      options.skipHydrateHashes = true;
      continue;
    }
    if (value === "--skip-capture") {
      options.skipCapture = true;
      continue;
    }
    if (value === "--skip-import") {
      options.skipImport = true;
      continue;
    }
    if (value === "--skip-generate-registry") {
      options.skipGenerateRegistry = true;
      continue;
    }
    positional.push(value);
  }

  options.manifestPath = positional[0] ? resolve(positional[0]) : "";
  return options;
}

export async function runStreamlineOfficialTagsPipeline({
  manifestPath,
  familyHash = microSolidSetHash,
  captureOutputPath,
  runtimeOutputPath,
  typesOutputPath,
  maxItems,
  concurrency = 1,
  requestDelayMs = 0,
  retryCount = 0,
  retryBaseDelayMs = 1000,
  apiKey,
  skipHydrateHashes = false,
  skipCapture = false,
  skipImport = false,
  skipGenerateRegistry = false,
} = {}) {
  if (!manifestPath) {
    throw new Error("runStreamlineOfficialTagsPipeline requires manifestPath");
  }

  const resolvedCaptureOutputPath = captureOutputPath || join(dirname(manifestPath), "captured-detail-sources.json");
  const steps = [];

  if (!skipHydrateHashes) {
    if (!apiKey) {
      throw new Error("STREAMLINE_API_KEY is required when hydrate hashes is enabled");
    }
    const hydrate = await hydrateManifestHashesFromFamily({
      manifestPath,
      familyHash,
      apiKey,
    });
    steps.push({ step: "hydrateHashes", ...hydrate });
  }

  if (!skipCapture) {
    const capture = await captureStreamlineDetailSources({
      manifestPath,
      outputPath: resolvedCaptureOutputPath,
      maxItems,
      concurrency,
      requestDelayMs,
      retryCount,
      retryBaseDelayMs,
    });
    steps.push({ step: "captureDetailSources", ...capture });
  }

  if (!skipImport) {
    const imported = await importStreamlineDetailSourceMetadata({
      manifestPath,
      sourcePath: resolvedCaptureOutputPath,
    });
    steps.push({ step: "importDetailSources", ...imported });
  }

  if (!skipGenerateRegistry) {
    if (!runtimeOutputPath || !typesOutputPath) {
      throw new Error("runtimeOutputPath and typesOutputPath are required when registry generation is enabled");
    }
    await mkdir(dirname(runtimeOutputPath), { recursive: true });
    await mkdir(dirname(typesOutputPath), { recursive: true });
    const generated = await generateSharedViewStreamlineIcons({
      manifestPaths: [manifestPath],
      runtimeOutputPath,
      typesOutputPath,
    });
    steps.push({
      step: "generateRegistry",
      runtimeOutputPath,
      typesOutputPath,
      families: generated.families,
      totalIcons: generated.totalIcons,
    });
  }

  return {
    manifestPath,
    captureOutputPath: resolvedCaptureOutputPath,
    steps,
  };
}

async function main(argv) {
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const parsed = parseCliArgs(argv);
  const manifestPath = parsed.manifestPath ? resolve(projectRoot, parsed.manifestPath) : "";
  if (!manifestPath) {
    throw new Error("Usage: node scripts/streamline-export/run-streamline-official-tags-pipeline.mjs <manifestPath> [--capture-output <path>] [--max-items <n>] [--concurrency <n>] [--request-delay-ms <n>] [--retry-count <n>] [--retry-base-delay-ms <n>] [--skip-hydrate-hashes] [--skip-capture] [--skip-import] [--skip-generate-registry]");
  }

  const result = await runStreamlineOfficialTagsPipeline({
    manifestPath,
    familyHash: parsed.familyHash,
    captureOutputPath: parsed.captureOutputPath ? resolve(projectRoot, parsed.captureOutputPath) : join(projectRoot, defaultArtifactsDir, "captured-detail-sources.json"),
    runtimeOutputPath: resolve(projectRoot, parsed.runtimeOutputPath),
    typesOutputPath: resolve(projectRoot, parsed.typesOutputPath),
    maxItems: parsed.maxItems,
    concurrency: parsed.concurrency,
    requestDelayMs: parsed.requestDelayMs,
    retryCount: parsed.retryCount,
    retryBaseDelayMs: parsed.retryBaseDelayMs,
    apiKey: process.env.STREAMLINE_API_KEY ?? "",
    skipHydrateHashes: parsed.skipHydrateHashes,
    skipCapture: parsed.skipCapture,
    skipImport: parsed.skipImport,
    skipGenerateRegistry: parsed.skipGenerateRegistry,
  });

  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("run-streamline-official-tags-pipeline.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
