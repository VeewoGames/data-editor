import { loadManifest, saveManifest, summarizeManifest } from "./lib/manifest-store.mjs";

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "Usage: node scripts/streamline-export/reset-streamline-manifest-items.mjs <manifestPath> --from-slug <slug> [--only-status <status>] [--error-contains <text>] [--contiguous] [--clear-attempts]",
    );
    process.exit(0);
  }

  const args = {
    manifestPath: argv[2] ?? null,
    fromSlug: null,
    onlyStatus: null,
    errorContains: null,
    contiguous: false,
    clearAttempts: false,
  };

  for (let index = 3; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--from-slug") {
      args.fromSlug = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (value === "--only-status") {
      args.onlyStatus = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (value === "--error-contains") {
      args.errorContains = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (value === "--contiguous") {
      args.contiguous = true;
      continue;
    }
    if (value === "--clear-attempts") {
      args.clearAttempts = true;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  if (!args.manifestPath || !args.fromSlug) {
    throw new Error(
      "Usage: node scripts/streamline-export/reset-streamline-manifest-items.mjs <manifestPath> --from-slug <slug> [--only-status <status>] [--error-contains <text>] [--contiguous] [--clear-attempts]",
    );
  }

  return args;
}

function matchesItem(item, options) {
  if (options.onlyStatus && item.status !== options.onlyStatus) {
    return false;
  }
  if (options.errorContains && !String(item.error ?? "").includes(options.errorContains)) {
    return false;
  }
  return true;
}

async function main(argv) {
  const options = parseArgs(argv);
  const manifest = await loadManifest(options.manifestPath);
  const startIndex = manifest.items.findIndex((item) => item.slug === options.fromSlug);

  if (startIndex < 0) {
    throw new Error(`Slug not found in manifest: ${options.fromSlug}`);
  }

  const before = summarizeManifest(manifest);
  const resetItems = [];
  let contiguousEnded = false;
  const nextItems = manifest.items.map((item, index) => {
    if (index < startIndex) {
      return item;
    }
    if (options.contiguous && contiguousEnded) {
      return item;
    }

    if (!matchesItem(item, options)) {
      if (options.contiguous && resetItems.length > 0) {
        contiguousEnded = true;
      }
      return item;
    }

    resetItems.push(item.slug);
    return {
      ...item,
      status: "pending",
      error: null,
      failedAt: null,
      ...(options.clearAttempts ? { attempts: 0 } : {}),
    };
  });

  if (!resetItems.length) {
    throw new Error("No manifest items matched the reset criteria");
  }

  const nextManifest = {
    ...manifest,
    items: nextItems,
  };
  await saveManifest(options.manifestPath, nextManifest);
  const after = summarizeManifest(nextManifest);

  console.log(JSON.stringify({
    manifestPath: options.manifestPath,
    resetCount: resetItems.length,
    resetItems,
    before,
    after,
  }, null, 2));
}

await main(process.argv);
